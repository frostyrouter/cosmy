import type { HealthSnapshotStore, ModelHealthSnapshot } from '../ports/stores.js';

export class InMemoryHealthStore implements HealthSnapshotStore {
  private successes = new Map<string, number>();
  private failures = new Map<string, number>();
  private latencies = new Map<string, number>();
  private updated = new Map<string, string>();

  markSuccess(modelId: string, latencyMs: number): void { this.successes.set(modelId, (this.successes.get(modelId) ?? 0) + 1); this.latencies.set(modelId, latencyMs); this.updated.set(modelId, new Date().toISOString()); }
  markFailure(modelId: string): void { this.failures.set(modelId, (this.failures.get(modelId) ?? 0) + 1); this.updated.set(modelId, new Date().toISOString()); }
  stats(modelId: string): { successes: number; failures: number } { return { successes: this.successes.get(modelId) ?? 0, failures: this.failures.get(modelId) ?? 0 }; }
  snapshot(): readonly ModelHealthSnapshot[] {
    const ids = new Set([...this.successes.keys(), ...this.failures.keys()]);
    return [...ids].sort().map((modelId) => ({ modelId, successes: this.successes.get(modelId) ?? 0, failures: this.failures.get(modelId) ?? 0, ...(this.latencies.has(modelId) ? { lastLatencyMs: this.latencies.get(modelId)! } : {}), updatedAt: this.updated.get(modelId) ?? new Date(0).toISOString() }));
  }
}
