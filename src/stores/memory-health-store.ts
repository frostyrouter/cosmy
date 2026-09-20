import type { HealthSnapshotStore, ModelHealthSnapshot } from '../ports/stores.js';
import { nowIso } from '../util/ids.js';

export class InMemoryHealthStore implements HealthSnapshotStore {
  private successes = new Map<string, number>();
  private failures = new Map<string, number>();
  private consecutiveFailures = new Map<string, number>();
  private latencies = new Map<string, number>();
  private updated = new Map<string, string>();

  markSuccess(modelId: string, latencyMs: number): void { this.successes.set(modelId, (this.successes.get(modelId) ?? 0) + 1); this.consecutiveFailures.set(modelId, 0); this.latencies.set(modelId, latencyMs); this.updated.set(modelId, nowIso()); }
  markFailure(modelId: string): void { this.failures.set(modelId, (this.failures.get(modelId) ?? 0) + 1); this.consecutiveFailures.set(modelId, (this.consecutiveFailures.get(modelId) ?? 0) + 1); this.updated.set(modelId, nowIso()); }
  stats(modelId: string): { successes: number; failures: number } { return { successes: this.successes.get(modelId) ?? 0, failures: this.failures.get(modelId) ?? 0 }; }
  snapshot(): readonly ModelHealthSnapshot[] {
    const ids = new Set([...this.successes.keys(), ...this.failures.keys()]);
    return [...ids].sort().map((modelId) => ({ modelId, successes: this.successes.get(modelId) ?? 0, failures: this.failures.get(modelId) ?? 0, consecutiveFailures: this.consecutiveFailures.get(modelId) ?? 0, ...(this.latencies.has(modelId) ? { lastLatencyMs: this.latencies.get(modelId)! } : {}), updatedAt: this.updated.get(modelId) ?? new Date(0).toISOString() }));
  }
}
