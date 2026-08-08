import type { ModelConfiguration, Usage } from '../domain/types.js';
import type { ModelHealthSnapshot, RegistrySnapshot, UsageReservation } from '../ports/stores.js';

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
}

export interface ResponseCache {
  get(key: string): Promise<{ value: string; expiresAt: string } | undefined>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface UsageRecord {
  tenantId: string;
  requestId: string;
  provider: string;
  model: string;
  usage: Usage;
  recordedAt: string;
}
