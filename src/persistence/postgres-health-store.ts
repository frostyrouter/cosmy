import type { HealthSnapshotStore, ModelHealthSnapshot } from '../ports/stores.js';
import type { SqlClient } from './sql-adapters.js';

interface HealthRow {
  model_id: string;
  successes: string | number;
  failures: string | number;
  consecutive_failures: string | number;
  last_latency_ms: string | number | null;
  updated_at: string | Date;
}

const columns = 'model_id, successes, failures, consecutive_failures, last_latency_ms, updated_at';

export class PostgresHealthStore implements HealthSnapshotStore {
  private readonly states = new Map<string, ModelHealthSnapshot>();
  private readonly pending = new Map<string, number>();
  private readonly revisions = new Map<string, number>();
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly db: SqlClient, private readonly onFailure?: () => void) {}

  markSuccess(modelId: string, latencyMs: number): void {
    this.revisions.set(modelId, (this.revisions.get(modelId) ?? 0) + 1);
    const current = this.local(modelId);
    this.states.set(modelId, { ...current, successes: current.successes + 1, consecutiveFailures: 0, lastLatencyMs: latencyMs, updatedAt: new Date().toISOString() });
    this.persist(modelId, 'success', latencyMs);
  }

  markFailure(modelId: string): void {
    this.revisions.set(modelId, (this.revisions.get(modelId) ?? 0) + 1);
    const current = this.local(modelId);
    this.states.set(modelId, { ...current, failures: current.failures + 1, consecutiveFailures: current.consecutiveFailures + 1, updatedAt: new Date().toISOString() });
    this.persist(modelId, 'failure');
  }

  snapshot(): readonly ModelHealthSnapshot[] {
    return [...this.states.values()].sort((left, right) => left.modelId.localeCompare(right.modelId)).map((entry) => ({ ...entry }));
  }

  async refresh(): Promise<void> {
    const pendingAtStart = new Set(this.pending.keys());
    const revisionsAtStart = new Map(this.revisions);
    try {
      const result = await this.db.query<HealthRow>(`SELECT ${columns} FROM provider_health_state`);
      for (const row of result.rows) {
        const unchanged = (this.revisions.get(row.model_id) ?? 0) === (revisionsAtStart.get(row.model_id) ?? 0);
        if (!pendingAtStart.has(row.model_id) && unchanged && (this.pending.get(row.model_id) ?? 0) === 0) this.states.set(row.model_id, healthSnapshot(row));
      }
    } catch (error) {
      this.onFailure?.();
      throw error;
    }
  }

  async flush(): Promise<void> { await this.queue; }

  private local(modelId: string): ModelHealthSnapshot {
    return this.states.get(modelId) ?? { modelId, successes: 0, failures: 0, consecutiveFailures: 0, updatedAt: new Date(0).toISOString() };
  }

  private persist(modelId: string, outcome: 'success' | 'failure', latencyMs?: number): void {
    this.pending.set(modelId, (this.pending.get(modelId) ?? 0) + 1);
    this.queue = this.queue.then(async () => {
      try {
        const success = outcome === 'success';
        const result = await this.db.query<HealthRow>(`WITH event AS (INSERT INTO provider_health_events (model_id, outcome, latency_ms, occurred_at) VALUES ($1, $2, $3, now())) INSERT INTO provider_health_state (model_id, successes, failures, consecutive_failures, last_latency_ms, updated_at) VALUES ($1, $4, $5, $5, $3, now()) ON CONFLICT (model_id) DO UPDATE SET successes = provider_health_state.successes + $4, failures = provider_health_state.failures + $5, consecutive_failures = CASE WHEN $4 = 1 THEN 0 ELSE provider_health_state.consecutive_failures + 1 END, last_latency_ms = CASE WHEN $4 = 1 THEN $3 ELSE provider_health_state.last_latency_ms END, updated_at = now() RETURNING ${columns}`, [modelId, outcome, latencyMs ?? null, success ? 1 : 0, success ? 0 : 1]);
        this.finishPending(modelId, result.rows[0]);
      } catch {
        this.finishPending(modelId);
        this.onFailure?.();
      }
    });
  }

  private finishPending(modelId: string, row?: HealthRow): void {
    const remaining = Math.max(0, (this.pending.get(modelId) ?? 1) - 1);
    if (remaining === 0) {
      this.pending.delete(modelId);
      if (row) this.states.set(modelId, healthSnapshot(row));
    } else this.pending.set(modelId, remaining);
  }
}

function healthSnapshot(row: HealthRow): ModelHealthSnapshot {
  return {
    modelId: row.model_id, successes: Number(row.successes), failures: Number(row.failures), consecutiveFailures: Number(row.consecutive_failures),
    ...(row.last_latency_ms === null ? {} : { lastLatencyMs: Number(row.last_latency_ms) }), updatedAt: new Date(row.updated_at).toISOString(),
  };
}
