import type { ModelConfiguration, Usage } from '../domain/types.js';

export interface ModelRegistry {
  snapshot(): readonly ModelConfiguration[];
  get(id: string): ModelConfiguration | undefined;
  replace(models: readonly ModelConfiguration[]): void;
}

export interface RegistrySnapshot {
  version: number;
  source: string;
  createdAt: string;
  models: readonly ModelConfiguration[];
}

export interface VersionedModelRegistry extends ModelRegistry {
  currentSnapshot(): RegistrySnapshot;
  publish(models: readonly ModelConfiguration[], source: string): RegistrySnapshot;
}

export interface UsageLedger {
  reserve(input: { tenantId: string; estimatedCostUsd: number }): Promise<UsageReservation>;
  reconcile(reservation: UsageReservation, actualCostUsd: number): Promise<void>;
  heartbeat?(reservation: UsageReservation): Promise<void>;
}

export interface BudgetSnapshot {
  tenantId: string;
  limitUsd?: number;
  reservedUsd: number;
  spentUsd: number;
}

export interface BudgetAdministration {
  budgetFor(tenantId: string): Promise<BudgetSnapshot>;
  setBudget(tenantId: string, limitUsd: number): Promise<BudgetSnapshot>;
}

export interface UsageReservation {
  id: string;
  tenantId: string;
  estimatedCostUsd: number;
}

export interface HealthStore {
  markSuccess(modelId: string, latencyMs: number): void;
  markFailure(modelId: string): void;
}

export interface ModelHealthSnapshot {
  modelId: string;
  successes: number;
  failures: number;
  consecutiveFailures: number;
  lastLatencyMs?: number;
  updatedAt: string;
}

export interface HealthSnapshotStore extends HealthStore {
  snapshot(): readonly ModelHealthSnapshot[];
}
