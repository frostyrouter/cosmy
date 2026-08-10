import type { ModelCapabilityVector, ModelConfiguration, PolicyHints, RequestDemandVector, RequestFeatures, RouteCandidate, Rejection } from '../domain/types.js';
import { requestDemandVectorVersion } from '../domain/types.js';
import { clamp } from '../util/ids.js';
import { parseModelCapabilityVector } from './vector.js';

export interface Policy {
  version: string;
  qualityWeight: number;
  costWeight: number;
  latencyWeight: number;
  creativityWeight: number;
  technicalityWeight: number;
  reasoningWeight: number;
}

export const defaultPolicy: Policy = {
  version: 'hybrid-cost-quality-v1', qualityWeight: 0.34, costWeight: 0.2, latencyWeight: 0.16,
  creativityWeight: 0.1, technicalityWeight: 0.1, reasoningWeight: 0.1,
};

const capabilityAxes = [
  'technicalDifficulty', 'reasoningDepth', 'creativity', 'designSkill', 'factualPrecision',
  'ambiguity', 'toolComplexity', 'contextComplexity', 'codingIntensity', 'safetyStakes',
] as const;

const capabilityWeights: Record<(typeof capabilityAxes)[number], number> = {
  technicalDifficulty: 0.12, reasoningDepth: 0.14, creativity: 0.06, designSkill: 0.13,
  factualPrecision: 0.14, ambiguity: 0.1, toolComplexity: 0.1, contextComplexity: 0.08,
  codingIntensity: 0.08, safetyStakes: 0.05,
};

export interface EligibilityResult {
  eligible: ModelConfiguration[];
  rejected: Rejection[];
}

function reject(rejected: Rejection[], model: ModelConfiguration, reason: string): void {
  rejected.push({ modelId: model.id, reason });
}

/** Legacy requests have no classifier vector; infer only requirements represented by old feature fields. */
export function legacyDemandVector(features: RequestFeatures): RequestDemandVector {
  return {
    version: requestDemandVectorVersion,
    technicalDifficulty: features.technicality,
    reasoningDepth: features.reasoning,
    creativity: features.creativity,
    designSkill: features.creativity,
    factualPrecision: 0,
    qualityRequirement: 0,
    ambiguity: 0,
    toolComplexity: features.hasTools ? 1 : 0,
    contextComplexity: clamp(features.inputTokens / 200_000),
    codingIntensity: features.technicality,
    safetyStakes: 0,
  };
}

function demandVector(features: RequestFeatures): RequestDemandVector {
  return features.demandVector ?? legacyDemandVector(features);
}

function modelVector(model: ModelConfiguration): ModelCapabilityVector {
  return parseModelCapabilityVector(model.capabilityVector);
}

export function capabilityCoverage(features: RequestFeatures, model: ModelConfiguration): number {
  const demand = demandVector(features);
  const capability = modelVector(model);
  const weightedShortfall = capabilityAxes.reduce((sum, axis) => sum + capabilityWeights[axis] * Math.max(0, demand[axis] - capability[axis]), 0);
  return clamp(1 - weightedShortfall);
}

function predictedTaskQuality(features: RequestFeatures, model: ModelConfiguration): number {
  return Math.min(model.coordinates.quality, capabilityCoverage(features, model));
}

function effectiveQualityFloor(features: RequestFeatures, hints: PolicyHints): number {
  if (features.demandVector) return Math.max(hints.minQuality ?? 0, features.demandVector.qualityRequirement);
  const legacyFloor = 0.65 + 0.2 * Math.max(features.technicality, features.reasoning);
  return Math.max(hints.minQuality ?? 0, clamp(Math.min(0.85, legacyFloor)));
}

export function filterEligible(
  models: readonly ModelConfiguration[], features: RequestFeatures, hints: PolicyHints = {},
): EligibilityResult {
  const eligible: ModelConfiguration[] = [];
  const rejected: Rejection[] = [];
  for (const model of models) {
    if (!model.enabled) { reject(rejected, model, 'model_disabled'); continue; }
    if (hints.preferProvider && model.provider !== hints.preferProvider) { reject(rejected, model, 'provider_preference'); continue; }
    if (features.inputTokens + features.requestedOutputTokens > model.contextWindow) { reject(rejected, model, 'context_window'); continue; }
    if (features.requestedOutputTokens > model.maxOutputTokens) { reject(rejected, model, 'max_output_tokens'); continue; }
    if (features.hasTools && !model.capabilities.includes('tools')) { reject(rejected, model, 'tools_unsupported'); continue; }
    if (features.needsStreaming && !model.capabilities.includes('streaming')) { reject(rejected, model, 'streaming_unsupported'); continue; }
    if (features.needsStructuredOutput && !model.capabilities.includes('structured-output')) { reject(rejected, model, 'structured_output_unsupported'); continue; }
    if (hints.requireCapabilities?.some((capability) => !model.capabilities.includes(capability))) { reject(rejected, model, 'required_capability_missing'); continue; }
    if (features.modalities.some((modality) => !model.modalities.includes(modality))) { reject(rejected, model, 'modality_unsupported'); continue; }
    if (!model.allowedDataClasses.includes(features.dataClass)) { reject(rejected, model, 'data_class_forbidden'); continue; }
    if (hints.region && !model.regions.includes('global') && !model.regions.includes(hints.region)) { reject(rejected, model, 'region_unavailable'); continue; }
    const estimatedCostUsd = cost(model, features);
    if (hints.maxCostUsd !== undefined && estimatedCostUsd > hints.maxCostUsd) { reject(rejected, model, 'max_cost_exceeded'); continue; }
    if (hints.maxLatencyMs !== undefined && model.health.latencyP95Ms > hints.maxLatencyMs) { reject(rejected, model, 'max_latency_exceeded'); continue; }
    if (predictedTaskQuality(features, model) < effectiveQualityFloor(features, hints)) { reject(rejected, model, 'quality_floor'); continue; }
    eligible.push(model);
  }
  return { eligible, rejected };
}

function cost(model: ModelConfiguration, features: RequestFeatures): number {
  return (features.inputTokens * model.pricing.inputPerMillionUsd + features.requestedOutputTokens * model.pricing.outputPerMillionUsd) / 1_000_000;
}

function reliability(model: ModelConfiguration): number {
  return clamp(model.health.availability * (1 - model.health.errorRate));
}

function containsAll(values: readonly string[], required: readonly string[]): boolean {
  return required.every((value) => values.includes(value));
}

function dominates(left: RouteCandidate, right: RouteCandidate): boolean {
  const preservesProviderAndCapabilities = left.model.provider === right.model.provider
    && containsAll(left.model.capabilities, right.model.capabilities)
    && containsAll(left.model.modalities, right.model.modalities);
  if (!preservesProviderAndCapabilities) return false;
  const noWorse = left.predictedTaskQuality >= right.predictedTaskQuality
    && reliability(left.model) >= reliability(right.model)
    && left.estimatedLatencyMs <= right.estimatedLatencyMs
    && left.estimatedCostUsd <= right.estimatedCostUsd;
  const strictlyBetter = left.predictedTaskQuality > right.predictedTaskQuality
    || reliability(left.model) > reliability(right.model)
    || left.estimatedLatencyMs < right.estimatedLatencyMs
    || left.estimatedCostUsd < right.estimatedCostUsd;
  return noWorse && strictlyBetter;
}

export function paretoPruneCandidates(candidates: readonly RouteCandidate[]): RouteCandidate[] {
  return candidates.filter((candidate, index) => !candidates.some((other, otherIndex) => otherIndex !== index && dominates(other, candidate)));
}

function compareNumber(left: number, right: number): number {
  const difference = left - right;
  return Math.abs(difference) <= 1e-12 ? 0 : difference;
}

export function rankCandidates(
  models: readonly ModelConfiguration[], features: RequestFeatures, _hints: PolicyHints = {}, _policy = defaultPolicy,
): RouteCandidate[] {
  const candidates = models.map((model) => {
    const estimatedCostUsd = cost(model, features);
    const estimatedLatencyMs = model.health.latencyP95Ms;
    const coverage = capabilityCoverage(features, model);
    const quality = Math.min(model.coordinates.quality, coverage);
    return {
      model, score: quality, capabilityCoverage: coverage, predictedTaskQuality: quality, estimatedCostUsd, estimatedLatencyMs,
      reasons: [`predicted_quality=${quality.toFixed(2)}`, `capability_coverage=${coverage.toFixed(2)}`, `cost=$${estimatedCostUsd.toFixed(6)}`, `latency=${estimatedLatencyMs}ms`],
    };
  });
  const frontier = paretoPruneCandidates(candidates);
  return frontier.sort((left, right) => compareNumber(left.estimatedCostUsd, right.estimatedCostUsd)
    || compareNumber(right.predictedTaskQuality, left.predictedTaskQuality)
    || compareNumber(reliability(right.model), reliability(left.model))
    || compareNumber(left.estimatedLatencyMs, right.estimatedLatencyMs)
    || (left.model.id < right.model.id ? -1 : left.model.id > right.model.id ? 1 : 0));
}
