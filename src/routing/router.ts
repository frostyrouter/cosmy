import { NoRouteError } from '../domain/errors.js';
import type { ModelRegistry } from '../ports/stores.js';
import type { Policy } from './policy.js';
import { defaultPolicy, filterEligible, rankCandidates } from './policy.js';
import { extractFeatures } from './features.js';
import type { PolicyHints, ResponseRequest, RouteDecision } from '../domain/types.js';
import { nowIso } from '../util/ids.js';

export interface ModelAdmission { allows(model: import('../domain/types.js').ModelConfiguration, tenantId?: string): boolean; }

export class DeterministicRouter {
  constructor(private readonly registry: ModelRegistry, private readonly policy: Policy = defaultPolicy, private readonly admission?: ModelAdmission) {}

  get policyVersion(): string { return this.policy.version; }

  decide(requestId: string, request: ResponseRequest): RouteDecision {
    const features = extractFeatures(request);
    const tenantId = request.policy?.tenantId;
    if (request.model) {
      const explicit = this.registry.get(request.model);
      if (!explicit) throw new NoRouteError(`Requested model '${request.model}' is not registered`);
      if (this.admission && !this.admission.allows(explicit, tenantId)) throw new NoRouteError('Requested model is not assigned to this tenant rollout', [{ modelId: explicit.id, reason: 'rollout_not_assigned' }]);
      const eligibility = filterEligible([explicit], features, request.policy);
      if (eligibility.eligible.length === 0) throw new NoRouteError('Requested model cannot satisfy this request', eligibility.rejected);
      const ranked = rankCandidates(eligibility.eligible, features, request.policy, this.policy);
      const selected = ranked[0];
      if (!selected) throw new NoRouteError('Requested model cannot satisfy this request');
      return { requestId, selected, alternatives: [], rejected: eligibility.rejected, features, policyVersion: this.policy.version, createdAt: nowIso() };
    }
    const rolloutRejected = this.admission ? this.registry.snapshot().filter((model) => !this.admission!.allows(model, tenantId)).map((model) => ({ modelId: model.id, reason: 'rollout_not_assigned' })) : [];
    const admitted = this.admission ? this.registry.snapshot().filter((model) => this.admission!.allows(model, tenantId)) : this.registry.snapshot();
    const eligibility = filterEligible(admitted, features, request.policy);
    eligibility.rejected.unshift(...rolloutRejected);
    const ranked = rankCandidates(eligibility.eligible, features, request.policy, this.policy);
    const selected = ranked[0];
    if (!selected) throw new NoRouteError('No registered model satisfies this request', eligibility.rejected);
    return { requestId, selected, alternatives: ranked.slice(1, 3), rejected: eligibility.rejected, features, policyVersion: this.policy.version, createdAt: nowIso() };
  }
}
