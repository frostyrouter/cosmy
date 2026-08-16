import { randomUUID } from 'node:crypto';
import type { ModelConfiguration } from '../domain/types.js';
import type { BudgetAdministration, BudgetSnapshot, RegistrySnapshot, VersionedModelRegistry } from '../ports/stores.js';
import type { AuditEvent, AuditPosition, ControlPlaneStore } from '../persistence/contracts.js';
import { nowIso } from '../util/ids.js';
import type { ModelPromotionEvidence } from './promotion.js';
import type { ModelRollout, RolloutOutcome } from '../rollouts/rollout.js';
import { RouterError } from '../domain/errors.js';
import type { ShadowCampaign, ShadowObservation, ShadowReservation } from '../shadow/shadow.js';

const maximumEvidenceVersions = 10_000;
const maximumEvidenceRecordsPerVersion = 20;

export class InMemoryControlPlaneStore implements ControlPlaneStore {
  private readonly audit: AuditEvent[] = [];
  private readonly evidence = new Map<string, ModelPromotionEvidence[]>();
  private readonly rollouts = new Map<string, ModelRollout>();
  private readonly shadowCampaigns = new Map<string, ShadowCampaign>();
  private readonly shadowReservations = new Map<string, { reservation: ShadowReservation; createdAtMs: number; reconciled: boolean }>();

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

  async listAudit(limit: number, before?: AuditPosition): Promise<readonly AuditEvent[]> {
    return this.audit
      .filter((event) => !before || event.occurredAt < before.occurredAt || (event.occurredAt === before.occurredAt && event.id < before.id))
      .sort((left, right) => left.occurredAt === right.occurredAt ? (left.id === right.id ? 0 : left.id > right.id ? -1 : 1) : left.occurredAt > right.occurredAt ? -1 : 1)
      .slice(0, limit)
      .map((event) => structuredClone(event));
  }

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

  async createShadowCampaign(input: Omit<ShadowCampaign, 'id' | 'state' | 'reservedUsd' | 'spentUsd' | 'sampleCount' | 'successCount' | 'errorCount' | 'createdAt' | 'updatedAt'> & { actorCredentialId: string; actorTenantId: string }): Promise<ShadowCampaign> {
    if ([...this.shadowCampaigns.values()].filter((campaign) => campaign.state === 'active').length >= 64) throw new RouterError('The active shadow campaign limit has been reached', 'shadow_campaign_limit', 409, false);
    if ([...this.shadowCampaigns.values()].some((campaign) => campaign.modelId === input.modelId && campaign.state === 'active')) throw new RouterError('An active shadow campaign already exists for this model', 'shadow_campaign_conflict', 409, false);
    const now = nowIso();
    const campaign: ShadowCampaign = { id: randomUUID(), modelId: input.modelId, modelVersion: input.modelVersion, state: 'active', samplePercentage: input.samplePercentage, budgetLimitUsd: input.budgetLimitUsd, reservedUsd: 0, spentUsd: 0, allowedDataClasses: [...input.allowedDataClasses], sampleCount: 0, successCount: 0, errorCount: 0, createdAt: now, updatedAt: now };
    this.shadowCampaigns.set(campaign.id, campaign);
    this.record(input.actorCredentialId, input.actorTenantId, 'shadow.start', `shadow:${campaign.id}`, { modelId: campaign.modelId, modelVersion: campaign.modelVersion, samplePercentage: campaign.samplePercentage, budgetLimitUsd: campaign.budgetLimitUsd });
    return structuredClone(campaign);
  }

  async shadowCampaign(id: string): Promise<ShadowCampaign | undefined> { const campaign = this.shadowCampaigns.get(id); return campaign ? structuredClone(campaign) : undefined; }
  async activeShadowCampaigns(): Promise<readonly ShadowCampaign[]> { return [...this.shadowCampaigns.values()].filter((campaign) => campaign.state === 'active').map((campaign) => structuredClone(campaign)); }

  async changeShadowCampaign(input: { id: string; action: 'pause' | 'resume' | 'complete'; actorCredentialId: string; actorTenantId: string }): Promise<ShadowCampaign> {
    const campaign = this.shadowCampaigns.get(input.id); if (!campaign) throw new RouterError('Shadow campaign was not found', 'shadow_campaign_not_found', 404, false);
    const valid = (input.action === 'pause' && campaign.state === 'active') || (input.action === 'resume' && campaign.state === 'paused') || (input.action === 'complete' && campaign.state !== 'completed');
    if (!valid) throw new RouterError('Shadow campaign action is invalid for its current state', 'shadow_campaign_state_conflict', 409, false);
    if (input.action === 'resume' && [...this.shadowCampaigns.values()].some((entry) => entry.id !== campaign.id && entry.modelId === campaign.modelId && entry.state === 'active')) throw new RouterError('An active shadow campaign already exists for this model', 'shadow_campaign_conflict', 409, false);
    if (input.action === 'resume' && [...this.shadowCampaigns.values()].filter((entry) => entry.state === 'active').length >= 64) throw new RouterError('The active shadow campaign limit has been reached', 'shadow_campaign_limit', 409, false);
    campaign.state = input.action === 'pause' ? 'paused' : input.action === 'resume' ? 'active' : 'completed'; campaign.updatedAt = nowIso();
    this.record(input.actorCredentialId, input.actorTenantId, `shadow.${input.action}`, `shadow:${campaign.id}`, {});
    return structuredClone(campaign);
  }

  async reserveShadow(campaignId: string, estimatedCostUsd: number): Promise<ShadowReservation> {
    if (!Number.isFinite(estimatedCostUsd) || estimatedCostUsd < 0) throw new Error('Shadow estimate must be non-negative');
    const campaign = this.shadowCampaigns.get(campaignId);
    if (!campaign || campaign.state !== 'active') throw new RouterError('Shadow campaign is not active', 'shadow_campaign_inactive', 409, false);
    if (campaign.spentUsd + campaign.reservedUsd + estimatedCostUsd > campaign.budgetLimitUsd) throw new RouterError('Shadow campaign budget would be exceeded', 'shadow_budget_exceeded', 409, false);
    const reservation = { id: randomUUID(), campaignId, estimatedCostUsd };
    campaign.reservedUsd += reservation.estimatedCostUsd; campaign.updatedAt = nowIso();
    this.shadowReservations.set(reservation.id, { reservation, createdAtMs: Date.now(), reconciled: false }); return structuredClone(reservation);
  }

  async reconcileShadow(reservation: ShadowReservation, actualCostUsd: number): Promise<void> {
    const stored = this.shadowReservations.get(reservation.id); if (!stored || stored.reconciled) return;
    stored.reconciled = true; const campaign = this.shadowCampaigns.get(reservation.campaignId); if (!campaign) return;
    campaign.reservedUsd = Math.max(0, campaign.reservedUsd - stored.reservation.estimatedCostUsd); campaign.spentUsd += Math.max(0, actualCostUsd); campaign.updatedAt = nowIso();
    if (campaign.spentUsd >= campaign.budgetLimitUsd) campaign.state = 'completed';
  }

  async recordShadowObservation(observation: ShadowObservation): Promise<void> {
    const campaign = this.shadowCampaigns.get(observation.campaignId); if (!campaign) return;
    campaign.sampleCount += 1; campaign.successCount += observation.status === 'success' ? 1 : 0; campaign.errorCount += observation.status === 'error' ? 1 : 0; campaign.updatedAt = nowIso();
  }

  async reconcileExpiredShadows(limit = 100): Promise<number> {
    let count = 0;
    for (const stored of this.shadowReservations.values()) {
      if (count >= limit || stored.reconciled || Date.now() - stored.createdAtMs < 300_000) continue;
      await this.reconcileShadow(stored.reservation, stored.reservation.estimatedCostUsd); count += 1;
    }
    return count;
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
