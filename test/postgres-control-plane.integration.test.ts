import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyControlPlaneMigrations, createPostgresSqlClient, type PostgresSqlClient } from '../src/persistence/postgres.js';
import { PostgresControlPlaneStore, PostgresReservationRepository } from '../src/persistence/sql-adapters.js';
import { defaultModels } from '../src/registry/default-models.js';
import { buildApp } from '../src/app.js';
import { sha256ApiKey } from '../src/security/auth.js';

const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)('PostgreSQL administrative control plane', () => {
  let db: PostgresSqlClient;
  let control: PostgresControlPlaneStore;
  let reservations: PostgresReservationRepository;

  beforeAll(async () => {
    db = await createPostgresSqlClient(databaseUrl!);
    await applyControlPlaneMigrations(db);
    control = new PostgresControlPlaneStore(db);
    reservations = new PostgresReservationRepository(db);
  });

  beforeEach(async () => {
    await db.query("DELETE FROM admin_audit_events WHERE actor_credential_id = 'control-admin'");
    await db.query('DELETE FROM model_manifests');
    await db.query('DELETE FROM model_registry_snapshots');
    await db.query("DELETE FROM usage_reservations WHERE tenant_id = 'control-tenant'");
    await db.query("DELETE FROM tenant_budgets WHERE tenant_id = 'control-tenant'");
  });
  afterAll(async () => { await db?.close(); });

  it('atomically publishes a snapshot and its actor audit record', async () => {
    const snapshot = await control.publishModels({ models: defaultModels.slice(0, 1), source: 'integration', actorCredentialId: 'control-admin', actorTenantId: 'platform' });
    expect(snapshot).toMatchObject({ source: 'integration' });
    await expect(control.listAudit(10)).resolves.toEqual([
      expect.objectContaining({ actorCredentialId: 'control-admin', actorTenantId: 'platform', action: 'models.publish', target: `registry:${snapshot.version}` }),
    ]);
  });

  it('serializes first-time budget creation against reservation admission', async () => {
    const results = await Promise.allSettled([
      control.setBudget({ tenantId: 'control-tenant', limitUsd: 0.01, actorCredentialId: 'control-admin', actorTenantId: 'platform' }),
      reservations.reserve({ tenantId: 'control-tenant', estimatedCostUsd: 0.02 }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const budget = await control.budgetFor('control-tenant');
    expect(budget.reservedUsd + budget.spentUsd).toBeLessThanOrEqual(budget.limitUsd ?? Number.POSITIVE_INFINITY);
  });

  it('rejects a limit below already consumed and reserved usage', async () => {
    const reservation = await reservations.reserve({ tenantId: 'control-tenant', estimatedCostUsd: 0.02 });
    await expect(control.setBudget({ tenantId: 'control-tenant', limitUsd: 0.01, actorCredentialId: 'control-admin', actorTenantId: 'platform' })).rejects.toMatchObject({ code: 'budget_below_usage', statusCode: 409 });
    await reservations.reconcile(reservation, 0);
    await expect(control.listAudit(10)).resolves.toEqual([]);
  });

  it('converges a second router instance on a committed registry version', async () => {
    const key = 'control-plane-integration-admin';
    const config = {
      host: '127.0.0.1', port: 0, logLevel: 'silent', environment: 'test' as const, requestTimeoutMs: 60_000, providerMaxRetries: 0,
      persistenceMode: 'postgres' as const, databaseUrl: databaseUrl!, registryRefreshSeconds: 1,
      apiCredentials: [{ id: 'control-admin', tenantId: 'platform', keySha256: sha256ApiKey(key), scopes: ['admin:write' as const] }],
    };
    const first = await buildApp(config);
    const second = await buildApp(config);
    try {
      const published = await first.inject({ method: 'PUT', url: '/v1/admin/models', headers: { authorization: `Bearer ${key}` }, payload: { source: 'two-instance-test', models: [defaultModels[0]] } });
      expect(published.statusCode).toBe(200);
      let observedSource = '';
      const deadline = Date.now() + 4_000;
      while (Date.now() < deadline && observedSource !== 'two-instance-test') {
        await new Promise((resolve) => setTimeout(resolve, 100));
        const snapshot = await second.inject({ method: 'GET', url: '/v1/admin/models', headers: { authorization: `Bearer ${key}` } });
        observedSource = snapshot.json().source;
      }
      expect(observedSource).toBe('two-instance-test');
    } finally {
      await first.close();
      await second.close();
    }
  });
});
