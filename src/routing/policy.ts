import type { ModelConfiguration, PolicyHints, RequestFeatures, RouteCandidate, Rejection } from '../domain/types.js';
import { clamp } from '../util/ids.js';

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
  version: 'default-v1', qualityWeight: 0.34, costWeight: 0.2, latencyWeight: 0.16,
  creativityWeight: 0.1, technicalityWeight: 0.1, reasoningWeight: 0.1,
};

export interface EligibilityResult {
  eligible: ModelConfiguration[];
  rejected: Rejection[];
}

function reject(rejected: Rejection[], model: ModelConfiguration, reason: string): void {
  rejected.push({ modelId: model.id, reason });
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
    if (hints.requireCapabilities && hints.requireCapabilities.some((capability) => !model.capabilities.includes(capability))) { reject(rejected, model, 'required_capability_missing'); continue; }
    if (features.modalities.some((modality) => !model.modalities.includes(modality))) { reject(rejected, model, 'modality_unsupported'); continue; }
    if (!model.allowedDataClasses.includes(features.dataClass)) { reject(rejected, model, 'data_class_forbidden'); continue; }
    if (hints.region && !model.regions.includes('global') && !model.regions.includes(hints.region)) { reject(rejected, model, 'region_unavailable'); continue; }
    if (hints.minQuality !== undefined && model.coordinates.quality < hints.minQuality) { reject(rejected, model, 'quality_floor'); continue; }
    if (hints.maxCostUsd !== undefined && cost(model, features) > hints.maxCostUsd) { reject(rejected, model, 'max_cost_exceeded'); continue; }
    if (hints.maxLatencyMs !== undefined && model.health.latencyP95Ms > hints.maxLatencyMs) { reject(rejected, model, 'max_latency_exceeded'); continue; }
    eligible.push(model);
  }
  return { eligible, rejected };
}

function cost(model: ModelConfiguration, features: RequestFeatures): number {
  return (features.inputTokens * model.pricing.inputPerMillionUsd + features.requestedOutputTokens * model.pricing.outputPerMillionUsd) / 1_000_000;
}

function distance(a: number, b: number): number { return 1 - Math.abs(a - b); }

export function rankCandidates(
  models: readonly ModelConfiguration[], features: RequestFeatures, hints: PolicyHints = {}, policy = defaultPolicy,
): RouteCandidate[] {
  const maxCost = hints.maxCostUsd ?? Number.POSITIVE_INFINITY;
  const maxLatency = hints.maxLatencyMs ?? Number.POSITIVE_INFINITY;
  return models.map((model) => {
    const estimatedCostUsd = cost(model, features);
    const estimatedLatencyMs = model.health.latencyP95Ms;
    const quality = model.coordinates.quality;
    const costScore = Number.isFinite(maxCost) ? clamp(1 - estimatedCostUsd / Math.max(maxCost, 0.000001)) : clamp(1 - estimatedCostUsd / 1);
    const latencyScore = Number.isFinite(maxLatency) ? clamp(1 - estimatedLatencyMs / Math.max(maxLatency, 1)) : clamp(1 - estimatedLatencyMs / 2_000);
    const score = policy.qualityWeight * quality + policy.costWeight * costScore + policy.latencyWeight * latencyScore
      + policy.creativityWeight * distance(features.creativity, model.coordinates.creativity)
      + policy.technicalityWeight * distance(features.technicality, model.coordinates.technicality)
      + policy.reasoningWeight * distance(features.reasoning, model.coordinates.reasoning);
    return {
      model, score, estimatedCostUsd, estimatedLatencyMs,
      reasons: [`quality=${quality.toFixed(2)}`, `cost=$${estimatedCostUsd.toFixed(6)}`, `latency=${estimatedLatencyMs}ms`],
    };
  }).sort((left, right) => right.score - left.score);
}
