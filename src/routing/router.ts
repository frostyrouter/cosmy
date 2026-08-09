import { NoRouteError } from '../domain/errors.js';
import type { ModelRegistry } from '../ports/stores.js';
import type { Policy } from './policy.js';
import { defaultPolicy, filterEligible, rankCandidates } from './policy.js';
import { extractFeatures } from './features.js';
import type { PolicyHints, ResponseRequest, RouteDecision } from '../domain/types.js';
import { nowIso } from '../util/ids.js';

export class DeterministicRouter {
  constructor(private readonly registry: ModelRegistry, private readonly policy: Policy = defaultPolicy) {}

  get policyVersion(): string { return this.policy.version; }

  decide(requestId: string, request: ResponseRequest): RouteDecision {
    const features = extractFeatures(request);
    if (request.model) {
      const explicit = this.registry.get(request.model);
      if (!explicit) throw new NoRouteError(`Requested model '${request.model}' is not registered`);
      const eligibility = filterEligible([explicit], features, request.policy);
      if (eligibility.eligible.length === 0) throw new NoRouteError('Requested model cannot satisfy this request', eligibility.rejected);
      const ranked = rankCandidates(eligibility.eligible, features, request.policy, this.policy);
      const selected = ranked[0];
      if (!selected) throw new NoRouteError('Requested model cannot satisfy this request');
      return { requestId, selected, alternatives: [], rejected: eligibility.rejected, features, policyVersion: this.policy.version, createdAt: nowIso() };
    }
    const eligibility = filterEligible(this.registry.snapshot(), features, request.policy);
    const ranked = rankCandidates(eligibility.eligible, features, request.policy, this.policy);
    const selected = ranked[0];
    if (!selected) throw new NoRouteError('No registered model satisfies this request', eligibility.rejected);
    return { requestId, selected, alternatives: ranked.slice(1, 3), rejected: eligibility.rejected, features, policyVersion: this.policy.version, createdAt: nowIso() };
  }
}
