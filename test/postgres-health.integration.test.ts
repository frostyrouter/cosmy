import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyControlPlaneMigrations, createPostgresSqlClient, type PostgresSqlClient } from '../src/persistence/postgres.js';
import { PostgresHealthStore } from '../src/persistence/postgres-health-store.js';

const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)('PostgreSQL shared provider health integration', () => {
  let db: PostgresSqlClient;

  beforeAll(async () => {
    db = await createPostgresSqlClient(databaseUrl!);
    await applyControlPlaneMigrations(db);
  });

  beforeEach(async () => {
    await db.query("DELETE FROM provider_health_events WHERE model_id = 'integration-health-model'");
    await db.query("DELETE FROM provider_health_state WHERE model_id = 'integration-health-model'");
  });
  afterAll(async () => { await db?.close(); });

  it('propagates failures and recovery between router instances', async () => {
    const first = new PostgresHealthStore(db);
    const second = new PostgresHealthStore(db);
    first.markFailure('integration-health-model');
    first.markFailure('integration-health-model');
    first.markFailure('integration-health-model');
    await first.flush();

    await second.refresh();
    expect(second.snapshot()[0]).toMatchObject({ failures: 3, consecutiveFailures: 3 });
    second.markSuccess('integration-health-model', 25);
    await second.flush();

    await first.refresh();
    expect(first.snapshot()[0]).toMatchObject({ successes: 1, failures: 3, consecutiveFailures: 0, lastLatencyMs: 25 });
  });
});
