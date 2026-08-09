import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ResponseResult } from '../src/domain/types.js';
import { applyControlPlaneMigrations, createPostgresSqlClient, type PostgresSqlClient } from '../src/persistence/postgres.js';
import { PostgresIdempotencyStore } from '../src/persistence/sql-adapters.js';

const databaseUrl = process.env.DATABASE_URL;
const response = { requestId: 'request-1', output: 'durable result' } as ResponseResult;

describe.skipIf(!databaseUrl)('PostgreSQL idempotency integration', () => {
  let db: PostgresSqlClient;
  let store: PostgresIdempotencyStore;

  beforeAll(async () => {
    db = await createPostgresSqlClient(databaseUrl!);
    await applyControlPlaneMigrations(db);
    store = new PostgresIdempotencyStore(db);
  });

  beforeEach(async () => { await db.query('TRUNCATE TABLE idempotency_records'); });
  afterAll(async () => { await db?.close(); });

  it('admits one concurrent execution and durably replays its result', async () => {
    const claims = await Promise.all([
      store.claim('tenant-a', 'key-1', 'hash-1', 60),
      store.claim('tenant-a', 'key-1', 'hash-1', 60),
    ]);
    expect(claims.map((claim) => claim.status).sort()).toEqual(['claimed', 'in-progress']);
    await store.complete('tenant-a', 'key-1', 'hash-1', response);
    await expect(store.claim('tenant-a', 'key-1', 'hash-1', 60)).resolves.toEqual({ status: 'replay', response });
    await expect(store.claim('tenant-a', 'key-1', 'different', 60)).resolves.toEqual({ status: 'conflict' });
  });
});
