import type { ModelConfiguration, ResponseResult, Usage } from '../domain/types.js';
import type { BudgetSnapshot, ModelHealthSnapshot, RegistrySnapshot, UsageReservation } from '../ports/stores.js';
import type { ModelPromotionEvidence } from '../control-plane/promotion.js';
import type { ModelRollout, RolloutOutcome } from '../rollouts/rollout.js';

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

export interface AuditEvent {
  id: string;
  actorCredentialId: string;
  actorTenantId: string;
  action: 'models.publish' | 'budget.set' | 'model_evidence.submit' | 'rollout.start' | 'rollout.promote' | 'rollout.rollback' | 'rollout.auto_rollback';
  target: string;
  details: Record<string, unknown>;
  occurredAt: string;
}

export interface ControlPlaneStore {
  publishModels(input: { models: readonly ModelConfiguration[]; source: string; actorCredentialId: string; actorTenantId: string }): Promise<RegistrySnapshot>;
  budgetFor(tenantId: string): Promise<BudgetSnapshot>;
  setBudget(input: { tenantId: string; limitUsd: number; actorCredentialId: string; actorTenantId: string }): Promise<BudgetSnapshot>;
  listAudit(limit: number): Promise<readonly AuditEvent[]>;
  submitEvidence(input: Omit<ModelPromotionEvidence, 'id' | 'submittedAt' | 'submittedByCredentialId'> & { actorCredentialId: string; actorTenantId: string }): Promise<ModelPromotionEvidence>;
  evidenceFor(modelId: string, modelVersion: string): Promise<ModelPromotionEvidence | undefined>;
  createRollout(input: Omit<ModelRollout, 'id' | 'state' | 'sampleCount' | 'errorCount' | 'totalLatencyMs' | 'reason' | 'createdAt' | 'updatedAt'> & { actorCredentialId: string; actorTenantId: string }): Promise<ModelRollout>;
  rollout(id: string): Promise<ModelRollout | undefined>;
  runtimeRollouts(): Promise<readonly ModelRollout[]>;
  changeRollout(input: { id: string; action: 'promote' | 'rollback'; reason?: string; actorCredentialId: string; actorTenantId: string }): Promise<ModelRollout>;
  recordRolloutOutcome(outcome: RolloutOutcome): Promise<ModelRollout | undefined>;
}

export interface UsageRecord {
  tenantId: string;
  requestId: string;
  provider: string;
  model: string;
  usage: Usage;
  recordedAt: string;
}
