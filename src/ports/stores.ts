import type { ModelConfiguration, Usage } from '../domain/types.js';

export interface ModelRegistry {
  snapshot(): readonly ModelConfiguration[];
  get(id: string): ModelConfiguration | undefined;
  replace(models: readonly ModelConfiguration[]): void;
}

export interface UsageLedger {
  reserve(input: { tenantId: string; estimatedCostUsd: number }): Promise<UsageReservation>;
  reconcile(reservation: UsageReservation, actualCostUsd: number): Promise<void>;
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
