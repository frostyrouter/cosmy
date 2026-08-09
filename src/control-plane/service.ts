import type { ModelConfiguration } from '../domain/types.js';
import { RouterError } from '../domain/errors.js';
import type { ControlPlaneStore } from '../persistence/contracts.js';
import type { InMemoryModelRegistry } from '../registry/memory-registry.js';
import type { RequestPrincipal } from '../security/auth.js';

export class ControlPlaneService {
  constructor(private readonly store: ControlPlaneStore, private readonly registry: InMemoryModelRegistry, private readonly availableProviders: ReadonlySet<string>) {}

  snapshot() { return this.registry.currentSnapshot(); }

  async publishModels(models: readonly ModelConfiguration[], source: string, actor: RequestPrincipal) {
    if (models.length === 0) throw new RouterError('A registry snapshot must contain at least one model', 'invalid_request', 400, false);
    const ids = new Set<string>();
    let enabled = 0;
    for (const model of models) {
      if (ids.has(model.id)) throw new RouterError(`Duplicate model id '${model.id}'`, 'invalid_request', 400, false);
      if (model.maxOutputTokens > model.contextWindow) throw new RouterError(`Model '${model.id}' output limit exceeds its context window`, 'invalid_request', 400, false);
      if (model.enabled && !this.availableProviders.has(model.provider)) throw new RouterError(`Enabled model '${model.id}' references an unavailable provider`, 'invalid_request', 400, false);
      if (model.enabled) enabled += 1;
      ids.add(model.id);
    }
    if (enabled === 0) throw new RouterError('A registry snapshot must contain at least one enabled model', 'invalid_request', 400, false);
    const snapshot = await this.store.publishModels({ models, source, actorCredentialId: actor.credentialId, actorTenantId: actor.tenantId });
    return this.registry.load(snapshot);
  }

  budgetFor(tenantId: string) { return this.store.budgetFor(tenantId); }

  setBudget(tenantId: string, limitUsd: number, actor: RequestPrincipal) {
    return this.store.setBudget({ tenantId, limitUsd, actorCredentialId: actor.credentialId, actorTenantId: actor.tenantId });
  }

  listAudit(limit: number) { return this.store.listAudit(limit); }
}
