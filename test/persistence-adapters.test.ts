import { describe, expect, it } from 'vitest';
import { PostgresControlPlaneStore, PostgresRegistryRepository, PostgresReservationRepository, type SqlClient } from '../src/persistence/sql-adapters.js';
import { defaultModels } from '../src/registry/default-models.js';

describe('durable persistence adapters', () => {
  it('publishes a registry snapshot transactionally', async () => {
    const queries: string[] = [];
    const db = {
      query: async (text: string) => { queries.push(text); return { rows: [{ version: 3, source: 'test', created_at: '2026-01-01T00:00:00Z' }] }; },
      transaction: async (work: (client: SqlClient) => Promise<unknown>) => work(db),
    } as unknown as SqlClient;
    const result = await new PostgresRegistryRepository(db).publish(defaultModels.slice(0, 1), 'test');
    expect(result.version).toBe(3);
    expect(result.models).toHaveLength(1);
    expect(queries.some((query) => query.includes('cosmy:registry-publish'))).toBe(true);
    expect(queries.some((query) => query.includes('model_manifests'))).toBe(true);
  });

  it('reconciles a reservation idempotently and reports totals', async () => {
    const db: SqlClient = {
      query: async <Row>(text: string) => {
        let rows: unknown[] = [];
        if (text.startsWith('INSERT INTO usage_reservations')) rows = [{ reservation_id: 'r1', tenant_id: 'acme', estimated_cost_usd: '0.01' }];
        else if (text.startsWith('SELECT COALESCE')) rows = [{ reserved_usd: '0', spent_usd: '0.004' }];
        return { rows: rows as Row[] };
      },
      transaction: async (work) => work(db),
    };
    const repository = new PostgresReservationRepository(db);
    const reservation = await repository.reserve({ tenantId: 'acme', estimatedCostUsd: 0.01 });
    await repository.reconcile(reservation, 0.004);
    expect(await repository.usageFor('acme')).toEqual({ reservedUsd: 0, spentUsd: 0.004 });
  });

  it('isolates rollout observations on their dedicated SQL client with server deadlines', async () => {
    const queries: string[] = [];
    const primary: SqlClient = { query: async () => { throw new Error('primary pool must not be used'); } };
    const rollout: SqlClient = {
      query: async <Row>(text: string) => {
        queries.push(text);
        const rows = text.startsWith('UPDATE model_rollouts') ? [{ id: 'r1', model_id: 'candidate', model_version: '2', state: 'canary', traffic_percentage: 5, minimum_samples: 20, maximum_error_rate: 0.1, maximum_average_latency_ms: 1000, sample_count: '1', error_count: '0', total_latency_ms: 20, reason: null, created_at: '2026-08-10T00:00:00Z', updated_at: '2026-08-10T00:00:01Z' }] : [];
        return { rows: rows as Row[] };
      },
      transaction: async (work) => work(rollout),
    };
    await expect(new PostgresControlPlaneStore(primary, rollout).recordRolloutOutcome({ modelId: 'candidate', modelVersion: '2', status: 'success', latencyMs: 20 })).resolves.toMatchObject({ sampleCount: 1 });
    expect(queries).toEqual(expect.arrayContaining([expect.stringContaining('statement_timeout'), expect.stringContaining('lock_timeout'), expect.stringContaining('UPDATE model_rollouts')]));
  });

  it('retries bounded PostgreSQL lock contention without double-counting an outcome', async () => {
    let transactions = 0;
    let updates = 0;
    const primary: SqlClient = { query: async () => { throw new Error('primary pool must not be used'); } };
    const rollout: SqlClient = {
      query: async <Row>(text: string) => {
        if (!text.startsWith('UPDATE model_rollouts')) return { rows: [] as Row[] };
        updates += 1;
        return { rows: [{ id: 'r1', model_id: 'candidate', model_version: '2', state: 'canary', traffic_percentage: 5, minimum_samples: 20, maximum_error_rate: 0.1, maximum_average_latency_ms: 1000, sample_count: '1', error_count: '0', total_latency_ms: 20, reason: null, created_at: '2026-08-10T00:00:00Z', updated_at: '2026-08-10T00:00:01Z' }] as Row[] };
      },
      transaction: async (work) => {
        transactions += 1;
        if (transactions < 3) throw Object.assign(new Error('lock timeout'), { code: '55P03' });
        return work(rollout);
      },
    };
    await expect(new PostgresControlPlaneStore(primary, rollout).recordRolloutOutcome({ modelId: 'candidate', modelVersion: '2', status: 'success', latencyMs: 20 })).resolves.toMatchObject({ sampleCount: 1 });
    expect(transactions).toBe(3);
    expect(updates).toBe(1);
  });

  it('enforces a tenant budget inside the reservation transaction', async () => {
    const queries: string[] = [];
    const db: SqlClient = {
      query: async <Row>(text: string) => {
        queries.push(text);
        const rows: unknown[] = text.includes('FROM tenant_budgets') ? [{ tenant_id: 'acme', limit_usd: '0.01', reserved_usd: '0.009', spent_usd: '0' }] : [];
        return { rows: rows as Row[] };
      },
      transaction: async (work) => work(db),
    };
    const repository = new PostgresReservationRepository(db, 0.01);
    await expect(repository.reserve({ tenantId: 'acme', estimatedCostUsd: 0.002 })).rejects.toMatchObject({ code: 'budget_exceeded', statusCode: 429 });
    expect(queries.some((query) => query.includes('spent_usd + reserved_usd'))).toBe(true);
    expect(queries.some((query) => query.startsWith('INSERT INTO usage_reservations'))).toBe(false);
  });
});
