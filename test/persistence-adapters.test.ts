import { describe, expect, it } from 'vitest';
import { PostgresRegistryRepository, PostgresReservationRepository, type SqlClient } from '../src/persistence/sql-adapters.js';
import { RedisResponseCache, type RedisClient } from '../src/persistence/redis-adapter.js';
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
    expect(queries.some((query) => query.includes('model_manifests'))).toBe(true);
  });

  it('reconciles a reservation idempotently and reports totals', async () => {
    const db = {
      query: async (text: string) => text.startsWith('INSERT') ? { rows: [{ reservation_id: 'r1', tenant_id: 'acme', estimated_cost_usd: '0.01' }] } : text.startsWith('SELECT') ? { rows: [{ reserved_usd: '0', spent_usd: '0.004' }] } : { rows: [] },
    } as unknown as SqlClient;
    const repository = new PostgresReservationRepository(db);
    const reservation = await repository.reserve({ tenantId: 'acme', estimatedCostUsd: 0.01 });
    await repository.reconcile(reservation, 0.004);
    expect(await repository.usageFor('acme')).toEqual({ reservedUsd: 0, spentUsd: 0.004 });
  });

  it('stores Redis values with a namespace and TTL', async () => {
    const values = new Map<string, string>();
    const redis: RedisClient = { get: async (key) => values.get(key) ?? null, set: async (key, value) => { values.set(key, value); }, del: async (key) => values.delete(key) ? 1 : 0 };
    const cache = new RedisResponseCache(redis, 'test:');
    await cache.set('key', 'value', 30);
    expect(await cache.get('key')).toMatchObject({ value: 'value' });
    expect(values.has('test:key')).toBe(true);
  });
});
