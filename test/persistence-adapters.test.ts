import { describe, expect, it } from 'vitest';
import { PostgresRegistryRepository, PostgresReservationRepository, type SqlClient } from '../src/persistence/sql-adapters.js';
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
