import type { HealthStore } from '../ports/stores.js';

export class InMemoryHealthStore implements HealthStore {
  private successes = new Map<string, number>();
  private failures = new Map<string, number>();

  markSuccess(modelId: string, _latencyMs: number): void { this.successes.set(modelId, (this.successes.get(modelId) ?? 0) + 1); }
  markFailure(modelId: string): void { this.failures.set(modelId, (this.failures.get(modelId) ?? 0) + 1); }
  stats(modelId: string): { successes: number; failures: number } { return { successes: this.successes.get(modelId) ?? 0, failures: this.failures.get(modelId) ?? 0 }; }
}
