import { randomUUID } from 'node:crypto';
import type { ModelConfiguration } from '../domain/types.js';
import type { BudgetAdministration, BudgetSnapshot, RegistrySnapshot, VersionedModelRegistry } from '../ports/stores.js';
import type { AuditEvent, ControlPlaneStore } from '../persistence/contracts.js';
import { nowIso } from '../util/ids.js';
import type { ModelPromotionEvidence } from './promotion.js';
import type { ModelRollout, RolloutOutcome } from '../rollouts/rollout.js';
import { RouterError } from '../domain/errors.js';

const maximumEvidenceVersions = 10_000;
const maximumEvidenceRecordsPerVersion = 20;

export class InMemoryControlPlaneStore implements ControlPlaneStore {
  private readonly audit: AuditEvent[] = [];
  private readonly evidence = new Map<string, ModelPromotionEvidence[]>();
  private readonly rollouts = new Map<string, ModelRollout>();

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

  async createRollout(input: Omit<ModelRollout, 'id' | 'state' | 'sampleCount' | 'errorCount' | 'totalLatencyMs' | 'reason' | 'createdAt' | 'updatedAt'> & { actorCredentialId: string; actorTenantId: string }): Promise<ModelRollout> {
    if ([...this.rollouts.values()].some((rollout) => rollout.modelId === input.modelId && rollout.state === 'canary')) throw new RouterError('A canary already exists for this model', 'rollout_conflict', 409, false);
    const now = nowIso();
    const rollout: ModelRollout = { id: randomUUID(), modelId: input.modelId, modelVersion: input.modelVersion, state: 'canary', trafficPercentage: input.trafficPercentage, minimumSamples: input.minimumSamples, maximumErrorRate: input.maximumErrorRate, maximumAverageLatencyMs: input.maximumAverageLatencyMs, sampleCount: 0, errorCount: 0, totalLatencyMs: 0, createdAt: now, updatedAt: now };
    this.rollouts.set(rollout.id, rollout);
    this.record(input.actorCredentialId, input.actorTenantId, 'rollout.start', `rollout:${rollout.id}`, { modelId: rollout.modelId, modelVersion: rollout.modelVersion, trafficPercentage: rollout.trafficPercentage });
    return structuredClone(rollout);
  }

  async rollout(id: string): Promise<ModelRollout | undefined> { const rollout = this.rollouts.get(id); return rollout ? structuredClone(rollout) : undefined; }
  async runtimeRollouts(): Promise<readonly ModelRollout[]> {
    const latest = new Map<string, ModelRollout>();
    for (const rollout of this.rollouts.values()) latest.set(rollout.modelId, rollout);
    return [...latest.values()].map((rollout) => structuredClone(rollout));
  }

  async changeRollout(input: { id: string; action: 'promote' | 'rollback'; reason?: string; actorCredentialId: string; actorTenantId: string }): Promise<ModelRollout> {
    const rollout = this.rollouts.get(input.id);
    if (!rollout || rollout.state !== 'canary') throw new RouterError('Canary rollout was not found or is no longer mutable', 'rollout_not_mutable', 409, false);
    if (input.action === 'promote' && !promotionThresholdsPass(rollout)) throw new RouterError('Canary has not met its minimum sample and health thresholds', 'rollout_not_ready', 409, false);
    rollout.state = input.action === 'promote' ? 'active' : 'rolled_back';
    if (input.reason) rollout.reason = input.reason; else delete rollout.reason;
    rollout.updatedAt = nowIso();
    this.record(input.actorCredentialId, input.actorTenantId, `rollout.${input.action}`, `rollout:${rollout.id}`, { reason: input.reason ?? null });
    return structuredClone(rollout);
  }

  async recordRolloutOutcome(outcome: RolloutOutcome): Promise<ModelRollout | undefined> {
    const rollout = [...this.rollouts.values()].find((entry) => entry.modelId === outcome.modelId && entry.modelVersion === outcome.modelVersion && entry.state === 'canary');
    if (!rollout || outcome.status === 'cancelled') return rollout ? structuredClone(rollout) : undefined;
    rollout.sampleCount += 1; rollout.errorCount += outcome.status === 'error' ? 1 : 0; rollout.totalLatencyMs += Math.max(0, outcome.latencyMs); rollout.updatedAt = nowIso();
    if (rollout.sampleCount >= rollout.minimumSamples) {
      const errorRate = rollout.errorCount / rollout.sampleCount; const averageLatencyMs = rollout.totalLatencyMs / rollout.sampleCount;
      if (errorRate > rollout.maximumErrorRate || averageLatencyMs > rollout.maximumAverageLatencyMs) {
        rollout.state = 'rolled_back'; rollout.reason = errorRate > rollout.maximumErrorRate ? 'error_rate_exceeded' : 'average_latency_exceeded';
        this.record('system', 'platform', 'rollout.auto_rollback', `rollout:${rollout.id}`, { reason: rollout.reason, sampleCount: rollout.sampleCount, errorRate, averageLatencyMs });
      }
    }
    return structuredClone(rollout);
  }

  private record(actorCredentialId: string, actorTenantId: string, action: AuditEvent['action'], target: string, details: Record<string, unknown>): void {
    this.audit.unshift({ id: randomUUID(), actorCredentialId, actorTenantId, action, target, details, occurredAt: nowIso() });
  }

  private evidenceKey(modelId: string, modelVersion: string): string { return `${modelId}\0${modelVersion}`; }
}

function promotionThresholdsPass(rollout: ModelRollout): boolean {
  return rollout.sampleCount >= rollout.minimumSamples
    && rollout.errorCount / rollout.sampleCount <= rollout.maximumErrorRate
    && rollout.totalLatencyMs / rollout.sampleCount <= rollout.maximumAverageLatencyMs;
}
