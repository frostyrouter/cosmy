import type { DecisionRecord, ModelConfiguration, ResponseResult, Usage } from '../domain/types.js';
import type { BudgetSnapshot, ModelHealthSnapshot, RegistrySnapshot, UsageReservation } from '../ports/stores.js';
import type { ModelPromotionEvidence } from '../control-plane/promotion.js';
import type { ModelRollout, RolloutOutcome } from '../rollouts/rollout.js';
import type { ShadowCampaign, ShadowObservation, ShadowReservation } from '../shadow/shadow.js';
import type { ApiCredential, ApiScope } from '../security/auth.js';

export interface ManagedApiCredential extends ApiCredential {
  createdAt: string;
  updatedAt: string;
}

export interface CredentialStore {
  listCredentials(): Promise<readonly ManagedApiCredential[]>;
  createCredential(input: { id: string; tenantId: string; keySha256: string; scopes: readonly ApiScope[]; actorCredentialId: string; actorTenantId: string }): Promise<ManagedApiCredential>;
  disableCredential(input: { id: string; actorCredentialId: string; actorTenantId: string }): Promise<ManagedApiCredential>;
}

export interface RegistryRepository {
  getCurrent(): Promise<RegistrySnapshot | undefined>;
  publish(models: readonly ModelConfiguration[], source: string): Promise<RegistrySnapshot>;
}

export interface HealthEventRepository {
  append(event: { modelId: string; outcome: 'success' | 'failure'; latencyMs?: number; occurredAt: string }): Promise<void>;
  aggregate(): Promise<readonly ModelHealthSnapshot[]>;
}

export interface ReservationRepository {
  reserve(input: { tenantId: string; estimatedCostUsd: number }): Promise<UsageReservation>;
  reconcile(reservation: UsageReservation, actualCostUsd: number): Promise<void>;
  usageFor(tenantId: string): Promise<{ reservedUsd: number; spentUsd: number }>;
  setBudget?(tenantId: string, limitUsd: number): Promise<void>;
  heartbeat?(reservation: UsageReservation): Promise<void>;
  reconcileExpired?(limit?: number): Promise<number>;
}

export interface ResponseCache {
  get(key: string): Promise<{ value: string; expiresAt: string } | undefined>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
}

export type IdempotencyClaim =
  | { status: 'claimed' }
  | { status: 'replay'; response: ResponseResult }
  | { status: 'conflict' }
  | { status: 'in-progress' };

export interface IdempotencyStore {
  claim(tenantId: string, key: string, requestHash: string, ttlSeconds: number): Promise<IdempotencyClaim>;
  complete(tenantId: string, key: string, requestHash: string, response: ResponseResult): Promise<void>;
  release(tenantId: string, key: string, requestHash: string): Promise<void>;
}

export interface DecisionStore {
  save(record: DecisionRecord): Promise<void>;
  get(tenantId: string, decisionId: string): Promise<DecisionRecord | undefined>;
}

export interface AuditEvent {
  id: string;
  actorCredentialId: string;
  actorTenantId: string;
  action: 'models.publish' | 'models.rollback' | 'models.disable' | 'budget.set' | 'credential.create' | 'credential.disable' | 'model_evidence.submit' | 'rollout.start' | 'rollout.promote' | 'rollout.rollback' | 'rollout.auto_rollback' | 'shadow.start' | 'shadow.pause' | 'shadow.resume' | 'shadow.complete';
  target: string;
  details: Record<string, unknown>;
  occurredAt: string;
}

export type AuditPosition = Pick<AuditEvent, 'id' | 'occurredAt'>;

export interface ControlPlaneStore {
  publishModels(input: { models: readonly ModelConfiguration[]; source: string; actorCredentialId: string; actorTenantId: string }): Promise<RegistrySnapshot>;
  registrySnapshot(version: number): Promise<RegistrySnapshot | undefined>;
  rollbackModels(input: { targetVersion: number; expectedCurrentVersion: number; reason: string; actorCredentialId: string; actorTenantId: string }): Promise<RegistrySnapshot>;
  disableModel(input: { modelId: string; expectedCurrentVersion: number; reason: string; actorCredentialId: string; actorTenantId: string }): Promise<RegistrySnapshot>;
  budgetFor(tenantId: string): Promise<BudgetSnapshot>;
  setBudget(input: { tenantId: string; limitUsd: number; actorCredentialId: string; actorTenantId: string }): Promise<BudgetSnapshot>;
  listAudit(limit: number, before?: AuditPosition): Promise<readonly AuditEvent[]>;
  submitEvidence(input: Omit<ModelPromotionEvidence, 'id' | 'submittedAt' | 'submittedByCredentialId'> & { actorCredentialId: string; actorTenantId: string }): Promise<ModelPromotionEvidence>;
  evidenceFor(modelId: string, modelVersion: string): Promise<ModelPromotionEvidence | undefined>;
  createRollout(input: Omit<ModelRollout, 'id' | 'state' | 'sampleCount' | 'errorCount' | 'totalLatencyMs' | 'reason' | 'createdAt' | 'updatedAt'> & { actorCredentialId: string; actorTenantId: string }): Promise<ModelRollout>;
  rollout(id: string): Promise<ModelRollout | undefined>;
  runtimeRollouts(): Promise<readonly ModelRollout[]>;
  changeRollout(input: { id: string; action: 'promote' | 'rollback'; reason?: string; actorCredentialId: string; actorTenantId: string }): Promise<ModelRollout>;
  recordRolloutOutcome(outcome: RolloutOutcome): Promise<ModelRollout | undefined>;
  createShadowCampaign(input: Omit<ShadowCampaign, 'id' | 'state' | 'reservedUsd' | 'spentUsd' | 'sampleCount' | 'successCount' | 'errorCount' | 'createdAt' | 'updatedAt'> & { actorCredentialId: string; actorTenantId: string }): Promise<ShadowCampaign>;
  shadowCampaign(id: string): Promise<ShadowCampaign | undefined>;
  activeShadowCampaigns(): Promise<readonly ShadowCampaign[]>;
  changeShadowCampaign(input: { id: string; action: 'pause' | 'resume' | 'complete'; actorCredentialId: string; actorTenantId: string }): Promise<ShadowCampaign>;
  reserveShadow(campaignId: string, estimatedCostUsd: number): Promise<ShadowReservation>;
  reconcileShadow(reservation: ShadowReservation, actualCostUsd: number): Promise<void>;
  recordShadowObservation(observation: ShadowObservation): Promise<void>;
  reconcileExpiredShadows(limit?: number): Promise<number>;
}

export interface UsageRecord {
  tenantId: string;
  requestId: string;
  provider: string;
  model: string;
  usage: Usage;
  recordedAt: string;
}
