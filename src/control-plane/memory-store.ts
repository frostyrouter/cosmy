import { randomUUID } from 'node:crypto';
import type { ModelConfiguration } from '../domain/types.js';
import type { BudgetAdministration, BudgetSnapshot, RegistrySnapshot, VersionedModelRegistry } from '../ports/stores.js';
import type { AuditEvent, ControlPlaneStore } from '../persistence/contracts.js';
import { nowIso } from '../util/ids.js';
import type { ModelPromotionEvidence } from './promotion.js';

const maximumEvidenceVersions = 10_000;
const maximumEvidenceRecordsPerVersion = 20;

export class InMemoryControlPlaneStore implements ControlPlaneStore {
  private readonly audit: AuditEvent[] = [];
  private readonly evidence = new Map<string, ModelPromotionEvidence[]>();

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

  async submitEvidence(input: Omit<ModelPromotionEvidence, 'id' | 'submittedAt' | 'submittedByCredentialId'> & { actorCredentialId: string; actorTenantId: string }): Promise<ModelPromotionEvidence> {
    const { actorCredentialId, actorTenantId, ...submitted } = input;
    const evidence: ModelPromotionEvidence = { ...submitted, id: randomUUID(), submittedByCredentialId: actorCredentialId, submittedAt: nowIso() };
    const key = this.evidenceKey(input.modelId, input.modelVersion);
    const existing = this.evidence.get(key);
    if (!existing && this.evidence.size >= maximumEvidenceVersions) {
      const oldestKey = this.evidence.keys().next().value as string | undefined;
      if (oldestKey) this.evidence.delete(oldestKey);
    }
    this.evidence.delete(key);
    this.evidence.set(key, [evidence, ...(existing ?? [])].slice(0, maximumEvidenceRecordsPerVersion));
    this.record(actorCredentialId, actorTenantId, 'model_evidence.submit', `model:${input.modelId}@${input.modelVersion}`, { suiteVersion: input.suiteVersion, datasetVersion: input.datasetVersion, sampleCount: input.sampleCount });
    return structuredClone(evidence);
  }

  async evidenceFor(modelId: string, modelVersion: string): Promise<ModelPromotionEvidence | undefined> {
    const evidence = this.evidence.get(this.evidenceKey(modelId, modelVersion))?.[0];
    return evidence ? structuredClone(evidence) : undefined;
  }

  private record(actorCredentialId: string, actorTenantId: string, action: AuditEvent['action'], target: string, details: Record<string, unknown>): void {
    this.audit.unshift({ id: randomUUID(), actorCredentialId, actorTenantId, action, target, details, occurredAt: nowIso() });
  }

  private evidenceKey(modelId: string, modelVersion: string): string { return `${modelId}\0${modelVersion}`; }
}
