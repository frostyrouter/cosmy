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
    await db.query("DELETE FROM model_promotion_evidence WHERE submitted_by_credential_id = 'control-admin'");
    await db.query('DELETE FROM model_manifests');
    await db.query('DELETE FROM model_registry_snapshots');
    await db.query("DELETE FROM usage_reservations WHERE tenant_id = 'control-tenant'");
    await db.query("DELETE FROM tenant_budgets WHERE tenant_id = 'control-tenant'");
  });
  afterAll(async () => { await db?.close(); });

  it('atomically publishes a snapshot and its actor audit record', async () => {
    await control.submitEvidence({ modelId: defaultModels[0]!.id, modelVersion: defaultModels[0]!.version, suiteVersion: 'suite-1', datasetVersion: 'dataset-1', conformancePassed: true, pricingVerified: true, usageVerified: true, routingPassRate: 0.99, qualityScore: 0.9, sampleCount: 200, evaluatedAt: new Date(Date.now() - 60_000).toISOString(), expiresAt: new Date(Date.now() + 86_400_000).toISOString(), actorCredentialId: 'control-admin', actorTenantId: 'platform' });
    const snapshot = await control.publishModels({ models: defaultModels.slice(0, 1), source: 'integration', actorCredentialId: 'control-admin', actorTenantId: 'platform' });
    expect(snapshot).toMatchObject({ source: 'integration' });
    await expect(control.listAudit(10)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ actorCredentialId: 'control-admin', actorTenantId: 'platform', action: 'models.publish', target: `registry:${snapshot.version}` }),
      expect.objectContaining({ action: 'model_evidence.submit', target: `model:${defaultModels[0]!.id}@${defaultModels[0]!.version}` }),
    ]));
  });

  it('rejects a new enabled version without passing evidence', async () => {
    const candidate = { ...structuredClone(defaultModels[0]!), id: 'postgres-candidate', version: '2' };
    await expect(control.publishModels({ models: [candidate], source: 'missing-evidence', actorCredentialId: 'control-admin', actorTenantId: 'platform' })).rejects.toMatchObject({ code: 'promotion_gate_failed', statusCode: 409 });
    expect(await control.evidenceFor(candidate.id, candidate.version)).toBeUndefined();
    expect((await db.query<{ count: string }>('SELECT COUNT(*) AS count FROM model_registry_snapshots')).rows[0]?.count).toBe('0');
    await expect(control.listAudit(10)).resolves.toEqual([]);
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
