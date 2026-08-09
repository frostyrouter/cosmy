import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyControlPlaneMigrations, createPostgresSqlClient, type PostgresSqlClient } from '../src/persistence/postgres.js';
import { PostgresReservationRepository } from '../src/persistence/sql-adapters.js';

const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)('PostgreSQL budget integration', () => {
  let db: PostgresSqlClient;
  let repository: PostgresReservationRepository;

  beforeAll(async () => {
    db = await createPostgresSqlClient(databaseUrl!);
    await applyControlPlaneMigrations(db);
    repository = new PostgresReservationRepository(db);
  });

  beforeEach(async () => {
    await db.query('TRUNCATE TABLE usage_reservations, tenant_budgets');
    await repository.setBudget('tenant-a', 0.01);
  });

  afterAll(async () => { await db?.close(); });

  it('atomically rejects concurrent reservations that would overspend', async () => {
    const attempts = await Promise.allSettled([
      repository.reserve({ tenantId: 'tenant-a', estimatedCostUsd: 0.007 }),
      repository.reserve({ tenantId: 'tenant-a', estimatedCostUsd: 0.007 }),
    ]);
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    const rejected = attempts.find((attempt) => attempt.status === 'rejected');
    expect(rejected).toMatchObject({ reason: { code: 'budget_exceeded', statusCode: 429 } });
    expect(await repository.usageFor('tenant-a')).toEqual({ reservedUsd: 0.007, spentUsd: 0 });
  });

  it('reconciles exactly once and releases capacity', async () => {
    const reservation = await repository.reserve({ tenantId: 'tenant-a', estimatedCostUsd: 0.007 });
    await repository.reconcile(reservation, 0.004);
    await repository.reconcile(reservation, 0.009);
    expect(await repository.usageFor('tenant-a')).toEqual({ reservedUsd: 0, spentUsd: 0.004 });
    await expect(repository.reserve({ tenantId: 'tenant-a', estimatedCostUsd: 0.006 })).resolves.toBeTruthy();
  });
});
