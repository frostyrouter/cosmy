import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyControlPlaneMigrations, createPostgresSqlClient, type PostgresSqlClient } from '../src/persistence/postgres.js';
import { PostgresControlPlaneStore, PostgresDecisionStore, PostgresReservationRepository } from '../src/persistence/sql-adapters.js';
import { defaultModels } from '../src/registry/default-models.js';
import { buildApp } from '../src/app.js';
import { sha256ApiKey } from '../src/security/auth.js';
import { newDecisionRecord } from './support/decision-fixture.js';

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
    await db.query("DELETE FROM route_decisions WHERE tenant_id LIKE 'control-%'");
    await db.query("DELETE FROM admin_audit_events WHERE actor_credential_id = 'control-admin' OR target LIKE 'rollout:%' OR target LIKE 'shadow:%'");
    await db.query("DELETE FROM shadow_observations WHERE campaign_id IN (SELECT id FROM shadow_campaigns WHERE model_id LIKE 'control-%')");
    await db.query("DELETE FROM shadow_reservations WHERE campaign_id IN (SELECT id FROM shadow_campaigns WHERE model_id LIKE 'control-%')");
    await db.query("DELETE FROM shadow_campaigns WHERE model_id LIKE 'control-%'");
    await db.query("DELETE FROM model_rollouts WHERE model_id LIKE 'control-%'");
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

  it('rejects a material change that reuses an enabled version', async () => {
    await control.submitEvidence({ modelId: defaultModels[0]!.id, modelVersion: defaultModels[0]!.version, suiteVersion: 'suite-1', datasetVersion: 'dataset-1', conformancePassed: true, pricingVerified: true, usageVerified: true, routingPassRate: 0.99, qualityScore: 0.9, sampleCount: 200, evaluatedAt: new Date(Date.now() - 60_000).toISOString(), expiresAt: new Date(Date.now() + 86_400_000).toISOString(), actorCredentialId: 'control-admin', actorTenantId: 'platform' });
    await control.publishModels({ models: defaultModels.slice(0, 1), source: 'initial', actorCredentialId: 'control-admin', actorTenantId: 'platform' });
    const changed = structuredClone(defaultModels[0]!);
    changed.allowedDataClasses = ['public'];
    await expect(control.publishModels({ models: [changed], source: 'version-reuse', actorCredentialId: 'control-admin', actorTenantId: 'platform' })).rejects.toMatchObject({ code: 'model_version_conflict', statusCode: 409 });
    expect((await db.query<{ count: string }>('SELECT COUNT(*) AS count FROM model_registry_snapshots')).rows[0]?.count).toBe('1');
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

  it('atomically rolls back a failing canary once across concurrent outcomes', async () => {
    const rollout = await control.createRollout({ modelId: 'control-canary', modelVersion: '2', trafficPercentage: 10, minimumSamples: 20, maximumErrorRate: 0.1, maximumAverageLatencyMs: 1_000, actorCredentialId: 'control-admin', actorTenantId: 'platform' });
    const outcomes = await Promise.all(Array.from({ length: 20 }, () => control.recordRolloutOutcome({ modelId: 'control-canary', modelVersion: '2', status: 'error', latencyMs: 10 })));
    expect(outcomes.filter((entry) => entry?.state === 'rolled_back')).toHaveLength(1);
    await expect(control.rollout(rollout.id)).resolves.toMatchObject({ state: 'rolled_back', reason: 'error_rate_exceeded', sampleCount: 20, errorCount: 20 });
    const audits = await control.listAudit(100);
    expect(audits.filter((event) => event.action === 'rollout.auto_rollback' && event.target === `rollout:${rollout.id}`)).toHaveLength(1);
  });

  it('serializes manual promotion behind canary acceptance thresholds', async () => {
    const rollout = await control.createRollout({ modelId: 'control-healthy', modelVersion: '2', trafficPercentage: 10, minimumSamples: 20, maximumErrorRate: 0.1, maximumAverageLatencyMs: 1_000, actorCredentialId: 'control-admin', actorTenantId: 'platform' });
    await expect(control.changeRollout({ id: rollout.id, action: 'promote', actorCredentialId: 'control-admin', actorTenantId: 'platform' })).rejects.toMatchObject({ code: 'rollout_not_ready' });
    await Promise.all(Array.from({ length: 20 }, () => control.recordRolloutOutcome({ modelId: 'control-healthy', modelVersion: '2', status: 'success', latencyMs: 100 })));
    await expect(control.changeRollout({ id: rollout.id, action: 'promote', actorCredentialId: 'control-admin', actorTenantId: 'platform' })).resolves.toMatchObject({ state: 'active', sampleCount: 20 });
  });

  it('atomically enforces a separate shadow budget and recovers abandoned reservations', async () => {
    const campaign = await control.createShadowCampaign({ modelId: 'control-shadow', modelVersion: '2', samplePercentage: 10, budgetLimitUsd: 1, allowedDataClasses: ['internal'], actorCredentialId: 'control-admin', actorTenantId: 'platform' });
    const attempts = await Promise.allSettled(Array.from({ length: 10 }, () => control.reserveShadow(campaign.id, 0.2)));
    const reservations = attempts.filter((entry): entry is PromiseFulfilledResult<Awaited<ReturnType<typeof control.reserveShadow>>> => entry.status === 'fulfilled').map((entry) => entry.value);
    expect(reservations).toHaveLength(5);
    await Promise.all(reservations.slice(0, 4).map((reservation) => control.reconcileShadow(reservation, 0.1)));
    await db.query("UPDATE shadow_reservations SET lease_expires_at = now() - interval '1 second' WHERE id = $1", [reservations[4]!.id]);
    await expect(control.reconcileExpiredShadows()).resolves.toBe(1);
    await control.recordShadowObservation({ id: '00000000-0000-4000-8000-000000000010', campaignId: campaign.id, primaryModelId: 'primary', shadowModelId: 'control-shadow', status: 'success', latencyMs: 20, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimatedCostUsd: 0.1 }, primaryOutputSha256: 'a'.repeat(64), shadowOutputSha256: 'b'.repeat(64), exactMatch: false, recordedAt: new Date().toISOString() });
    await expect(control.shadowCampaign(campaign.id)).resolves.toMatchObject({ reservedUsd: 0, spentUsd: 0.6, sampleCount: 1, successCount: 1 });
  });

  it('rejects a limit below already consumed and reserved usage', async () => {
    const reservation = await reservations.reserve({ tenantId: 'control-tenant', estimatedCostUsd: 0.02 });
    await expect(control.setBudget({ tenantId: 'control-tenant', limitUsd: 0.01, actorCredentialId: 'control-admin', actorTenantId: 'platform' })).rejects.toMatchObject({ code: 'budget_below_usage', statusCode: 409 });
    await reservations.reconcile(reservation, 0);
    await expect(control.listAudit(10)).resolves.toEqual([]);
  });

  it('persists decisions without exposing them across tenants', async () => {
    const decisions = new PostgresDecisionStore(db);
    const record = newDecisionRecord({ id: 'control-decision', tenantId: 'control-tenant' });
    await decisions.save(record);
    await expect(decisions.get('control-tenant', record.id)).resolves.toMatchObject({ id: record.id, tenantId: 'control-tenant', state: 'planned' });
    await expect(decisions.get('control-other', record.id)).resolves.toBeUndefined();
  });

  it('persists route-less rejections and candidate attempt history', async () => {
    const decisions = new PostgresDecisionStore(db);
    const { route: _route, ...rejectionBase } = newDecisionRecord();
    const rejected: import('../src/domain/types.js').DecisionRecord = {
      ...rejectionBase, id: 'control-rejected', tenantId: 'control-tenant', state: 'rejected', attempts: [], errorCode: 'no_eligible_model',
      rejection: { code: 'no_eligible_model', statusCode: 422, retryable: false, candidates: [{ modelId: 'candidate', reason: 'max_cost_exceeded' }] },
    };
    await decisions.save(rejected);
    await expect(decisions.get('control-tenant', rejected.id)).resolves.toMatchObject({ state: 'rejected', route: undefined, attempts: [], rejection: { candidates: [{ reason: 'max_cost_exceeded' }] } });

    const completed = newDecisionRecord({ id: 'control-attempts', tenantId: 'control-tenant', state: 'completed', attempts: [{ index: 0, modelId: 'candidate', model: 'candidate-v1', provider: 'provider-a', status: 'failed', latencyMs: 12, startedAt: '2026-08-12T00:00:00.000Z', completedAt: '2026-08-12T00:00:00.012Z', errorCode: 'provider_error' }] });
    await decisions.save(completed);
    await expect(decisions.get('control-tenant', completed.id)).resolves.toMatchObject({ state: 'completed', attempts: [{ modelId: 'candidate', status: 'failed', errorCode: 'provider_error' }] });
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
