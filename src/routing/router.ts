import { NoRouteError, RequestCancelledError, RouterError } from '../domain/errors.js';
import type { ClassificationStatus, ModelConfiguration, RequestFeatures, ResponseRequest, RouteCandidate, RouteDecision, RouteMetadata } from '../domain/types.js';
import type { HealthSnapshotStore, ModelHealthSnapshot, ModelRegistry } from '../ports/stores.js';
import type { RequestClassifier, RequestClassificationInput } from '../ports/classifier.js';
import { defaultPolicy, filterEligible, rankCandidates, type Policy } from './policy.js';
import { extractFeatures, mergeClassification } from './features.js';
import { parseRequestClassification } from './vector.js';
import { nowIso } from '../util/ids.js';

export interface ModelAdmission { allows(model: import('../domain/types.js').ModelConfiguration, tenantId?: string): boolean; }
export type ClassificationFailureMode = 'degrade' | 'fail';

export interface RouterOptions {
  policy?: Policy;
  classifier?: RequestClassifier;
  classifierTimeoutMs?: number;
  failureMode?: ClassificationFailureMode;
  admission?: ModelAdmission;
  health?: HealthSnapshotStore;
  healthFailureThreshold?: number;
  healthCooldownMs?: number;
}

const defaultClassifierTimeoutMs = 5_000;

function routeMetadata(classificationStatus: ClassificationStatus, initialModelId: string, selectedModelId: string, promoted: boolean): RouteMetadata {
  return { classificationStatus, reasoningGate: { initialModelId, selectedModelId, promoted } };
}

function supportsReasoning(candidate: RouteCandidate): boolean { return candidate.model.capabilities.includes('reasoning'); }

function classificationFailure(error: unknown): RouterError {
  const timedOut = error instanceof RouterError && error.code === 'classification_timeout';
  return new RouterError(timedOut ? 'Request classification timed out' : 'Request classification failed', timedOut ? 'classification_timeout' : 'classification_failed', timedOut ? 504 : 503, true);
}

async function classifyWithTimeout(classifier: RequestClassifier, input: RequestClassificationInput, timeoutMs: number): Promise<unknown> {
  if (input.signal.aborted) throw new RequestCancelledError();
  const controller = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let abortHandler: (() => void) | undefined;
  let timedOut = false;
  try {
    const classifierPromise = Promise.resolve().then(() => classifier.classify({ ...input, signal: controller.signal }));
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => { timedOut = true; controller.abort(); reject(new RouterError('Request classification timed out', 'classification_timeout', 504, true)); }, timeoutMs);
    });
    const cancellationPromise = new Promise<never>((_, reject) => {
      abortHandler = () => { controller.abort(); reject(new RequestCancelledError()); };
      input.signal.addEventListener('abort', abortHandler, { once: true });
      if (input.signal.aborted) abortHandler();
    });
    return await Promise.race([classifierPromise, timeoutPromise, cancellationPromise]);
  } catch (error) {
    if (input.signal.aborted) throw new RequestCancelledError();
    if (timedOut) throw new RouterError('Request classification timed out', 'classification_timeout', 504, true);
    throw error;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (abortHandler) input.signal.removeEventListener('abort', abortHandler);
    controller.abort();
  }
}

export class DeterministicRouter {
  private readonly policy: Policy;
  private readonly classifier: RequestClassifier | undefined;
  private readonly classifierTimeoutMs: number;
  private readonly failureMode: ClassificationFailureMode;
  private readonly admission: ModelAdmission | undefined;
  private readonly health: HealthSnapshotStore | undefined;
  private readonly healthFailureThreshold: number;
  private readonly healthCooldownMs: number;

  constructor(
    private readonly registry: ModelRegistry,
    policyOrOptions: Policy | RouterOptions = defaultPolicy,
    legacyAdmission?: ModelAdmission,
  ) {
    const isPolicy = 'version' in policyOrOptions;
    const routingOptions = isPolicy ? {} : policyOrOptions;
    this.policy = isPolicy ? policyOrOptions : routingOptions.policy ?? defaultPolicy;
    this.classifier = routingOptions.classifier;
    this.classifierTimeoutMs = Math.max(1, routingOptions.classifierTimeoutMs ?? defaultClassifierTimeoutMs);
    this.failureMode = routingOptions.failureMode ?? 'degrade';
    this.admission = routingOptions.admission ?? legacyAdmission;
    this.health = routingOptions.health;
    this.healthFailureThreshold = Math.max(1, routingOptions.healthFailureThreshold ?? 3);
    this.healthCooldownMs = Math.max(1, routingOptions.healthCooldownMs ?? 30_000);
  }

  get policyVersion(): string { return this.policy.version; }

  listModels(tenantId?: string): readonly ModelConfiguration[] {
    const observed = new Map(this.health?.snapshot().map((snapshot) => [snapshot.modelId, snapshot]) ?? []);
    return this.registry.snapshot().filter((model) => model.enabled && (!this.admission || this.admission.allows(model, tenantId)))
      .map((model) => structuredClone(overlayHealth(model, observed.get(model.id))));
  }

  decide(requestId: string, request: ResponseRequest): RouteDecision {
    return this.buildRoute(requestId, request, extractFeatures(request), 'deterministic');
  }

  async decideAsync(requestId: string, request: ResponseRequest, signal: AbortSignal): Promise<RouteDecision> {
    if (signal.aborted) throw new RequestCancelledError();
    const deterministicFeatures = extractFeatures(request);
    const classifier = this.classifier;
    if (!classifier) return this.buildRoute(requestId, request, deterministicFeatures, 'deterministic');
    let features = deterministicFeatures;
    let classificationStatus: ClassificationStatus = 'classified';
    try {
      const rawClassification = await classifyWithTimeout(classifier, { request, deterministicFeatures, signal }, this.classifierTimeoutMs);
      features = mergeClassification(deterministicFeatures, parseRequestClassification(rawClassification));
    } catch (error) {
      if (signal.aborted || error instanceof RequestCancelledError) throw new RequestCancelledError();
      if (this.failureMode === 'fail') throw classificationFailure(error);
      classificationStatus = 'degraded';
    }
    if (signal.aborted) throw new RequestCancelledError();
    return this.buildRoute(requestId, request, features, classificationStatus);
  }

  private buildRoute(requestId: string, request: ResponseRequest, features: RequestFeatures, classificationStatus: ClassificationStatus): RouteDecision {
    const tenantId = request.policy?.tenantId;
    const observed = new Map(this.health?.snapshot().map((snapshot) => [snapshot.modelId, snapshot]) ?? []);
    const withObservedHealth = (model: ModelConfiguration): ModelConfiguration => overlayHealth(model, observed.get(model.id));
    const healthUnavailable = (model: ModelConfiguration): boolean => {
      const snapshot = observed.get(model.id);
      return snapshot !== undefined && snapshot.consecutiveFailures >= this.healthFailureThreshold
        && Date.now() - Date.parse(snapshot.updatedAt) < this.healthCooldownMs;
    };
    if (request.model) {
      const explicit = this.registry.get(request.model);
      if (!explicit) throw new NoRouteError(`Requested model '${request.model}' is not registered`);
      if (this.admission && !this.admission.allows(explicit, tenantId)) throw new NoRouteError('Requested model is not assigned to this tenant rollout', [{ modelId: explicit.id, reason: 'rollout_not_assigned' }]);
      if (healthUnavailable(explicit)) throw new NoRouteError('Requested model is temporarily unavailable', [{ modelId: explicit.id, reason: 'observed_health_unavailable' }]);
      const eligibility = filterEligible([withObservedHealth(explicit)], features, request.policy, { bypassInferredQualityFloor: true });
      if (eligibility.eligible.length === 0) throw new NoRouteError('Requested model cannot satisfy this request', eligibility.rejected);
      const selected = rankCandidates(eligibility.eligible, features, request.policy, this.policy)[0];
      if (!selected) throw new NoRouteError('Requested model cannot satisfy this request');
      if (features.deepReasoningRequired === true && !supportsReasoning(selected)) throw new NoRouteError('Requested model cannot satisfy deep reasoning requirement', [...eligibility.rejected, { modelId: selected.model.id, reason: 'deep_reasoning_required' }]);
      return { requestId, selected, alternatives: [], rejected: eligibility.rejected, features, policyVersion: this.policy.version, createdAt: nowIso(), metadata: routeMetadata(classificationStatus, selected.model.id, selected.model.id, false) };
    }
    const allModels = this.registry.snapshot();
    const rolloutRejected = this.admission ? allModels.filter((model) => !this.admission!.allows(model, tenantId)).map((model) => ({ modelId: model.id, reason: 'rollout_not_assigned' })) : [];
    const healthRejected = allModels.filter((model) => (!this.admission || this.admission.allows(model, tenantId)) && healthUnavailable(model)).map((model) => ({ modelId: model.id, reason: 'observed_health_unavailable' }));
    const admitted = allModels.filter((model) => (!this.admission || this.admission.allows(model, tenantId)) && !healthUnavailable(model)).map(withObservedHealth);
    const eligibility = filterEligible(admitted, features, request.policy);
    eligibility.rejected.unshift(...rolloutRejected, ...healthRejected);
    const ranked = rankCandidates(eligibility.eligible, features, request.policy, this.policy);
    const initial = ranked[0];
    if (!initial) throw new NoRouteError('No registered model satisfies this request', eligibility.rejected);
    let selected = initial;
    let alternatives: RouteCandidate[] = ranked.slice(1, 3);
    let promoted = false;
    if (features.deepReasoningRequired === true) {
      const reasoningCandidates = ranked.filter(supportsReasoning);
      if (!supportsReasoning(initial)) {
        const reasoningCandidate = reasoningCandidates[0];
        if (!reasoningCandidate) throw new NoRouteError('No reasoning-capable model satisfies this request', [...eligibility.rejected, ...ranked.map((candidate) => ({ modelId: candidate.model.id, reason: 'deep_reasoning_required' }))]);
        selected = reasoningCandidate;
        promoted = true;
      }
      alternatives = reasoningCandidates.filter((candidate) => candidate.model.id !== selected.model.id).slice(0, 2);
    }
    return { requestId, selected, alternatives, rejected: eligibility.rejected, features, policyVersion: this.policy.version, createdAt: nowIso(), metadata: routeMetadata(classificationStatus, initial.model.id, selected.model.id, promoted) };
  }
}

function overlayHealth(model: ModelConfiguration, snapshot?: ModelHealthSnapshot): ModelConfiguration {
  if (!snapshot) return model;
  const observations = snapshot.successes + snapshot.failures;
  const observedErrorRate = observations === 0 ? model.health.errorRate : snapshot.failures / observations;
  return {
    ...model,
    health: {
      availability: Math.min(model.health.availability, 1 - observedErrorRate),
      errorRate: Math.max(model.health.errorRate, observedErrorRate),
      // A single observed latency is not a p95 and must not permanently violate latency policy.
      latencyP95Ms: model.health.latencyP95Ms,
      checkedAt: snapshot.updatedAt,
    },
  };
}
