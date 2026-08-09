import { randomUUID } from 'node:crypto';
import type { ModelConfiguration } from '../domain/types.js';
import type { BudgetAdministration, BudgetSnapshot, RegistrySnapshot, VersionedModelRegistry } from '../ports/stores.js';
import type { AuditEvent, ControlPlaneStore } from '../persistence/contracts.js';
import { nowIso } from '../util/ids.js';

export class InMemoryControlPlaneStore implements ControlPlaneStore {
  private readonly audit: AuditEvent[] = [];

  constructor(private readonly registry: VersionedModelRegistry, private readonly budgets: BudgetAdministration) {}

  async publishModels(input: { models: readonly ModelConfiguration[]; source: string; actorCredentialId: string; actorTenantId: string }): Promise<RegistrySnapshot> {
    const result = this.registry.publish(input.models, input.source);
    this.record(input.actorCredentialId, input.actorTenantId, 'models.publish', `registry:${result.version}`, { source: input.source, modelCount: input.models.length });
    return result;
  }

  budgetFor(tenantId: string): Promise<BudgetSnapshot> { return this.budgets.budgetFor(tenantId); }

  async setBudget(input: { tenantId: string; limitUsd: number; actorCredentialId: string; actorTenantId: string }): Promise<BudgetSnapshot> {
    const result = await this.budgets.setBudget(input.tenantId, input.limitUsd);
    this.record(input.actorCredentialId, input.actorTenantId, 'budget.set', `tenant:${input.tenantId}`, { limitUsd: input.limitUsd });
    return result;
  }

  async listAudit(limit: number): Promise<readonly AuditEvent[]> { return this.audit.slice(0, limit).map((event) => structuredClone(event)); }

  private record(actorCredentialId: string, actorTenantId: string, action: AuditEvent['action'], target: string, details: Record<string, unknown>): void {
    this.audit.unshift({ id: randomUUID(), actorCredentialId, actorTenantId, action, target, details, occurredAt: nowIso() });
  }
}
