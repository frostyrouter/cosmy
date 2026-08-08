import type { ModelConfiguration, Usage } from '../domain/types.js';

export interface ModelRegistry {
  snapshot(): readonly ModelConfiguration[];
  get(id: string): ModelConfiguration | undefined;
  replace(models: readonly ModelConfiguration[]): void;
}

export interface UsageLedger {
  reserve(input: { tenantId: string; estimatedCostUsd: number }): Promise<void>;
  record(input: { tenantId: string; usage: Usage }): Promise<void>;
}

export interface HealthStore {
  markSuccess(modelId: string, latencyMs: number): void;
  markFailure(modelId: string): void;
}
