import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyControlPlaneMigrations, createPostgresSqlClient, type PostgresSqlClient } from '../src/persistence/postgres.js';
import { PostgresControlPlaneStore, PostgresDecisionStore, PostgresReservationRepository } from '../src/persistence/sql-adapters.js';
import { defaultModels } from '../src/registry/default-models.js';
import { buildApp } from '../src/app.js';
import { sha256ApiKey } from '../src/security/auth.js';
import { newDecisionRecord } from './support/decision-fixture.js';
import { PostgresCredentialStore } from '../src/persistence/postgres-credentials.js';
import { readFile } from 'node:fs/promises';

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
    await db.query("DELETE FROM tenant_budgets WHERE tenant_id = 'control-tenant' OR tenant_id LIKE 'control-audit-%'");
    await db.query("DELETE FROM api_credentials WHERE credential_id LIKE 'control-%'");
    await db.query("DELETE FROM tenant_policies WHERE tenant_id LIKE 'control-%'");
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

  it('detects audit content tampering and verifies a restored chain', async () => {
    await control.setBudget({ tenantId: 'control-audit-integrity', limitUsd: 10, actorCredentialId: 'control-admin', actorTenantId: 'platform' });
    await expect(control.verifyAudit()).resolves.toMatchObject({ valid: true, checkedEvents: 1, headSequence: 1, headHash: expect.stringMatching(/^[0-9a-f]{64}$/u) });
    const event = (await db.query<{ id: string; details: Record<string, unknown> }>("SELECT id, details FROM admin_audit_events WHERE actor_credential_id = 'control-admin' ORDER BY chain_sequence DESC LIMIT 1")).rows[0]!;
    await db.query("UPDATE admin_audit_events SET details = '{\"limitUsd\":999}'::jsonb WHERE id = $1", [event.id]);
    await expect(control.verifyAudit()).resolves.toMatchObject({ valid: false, checkedEvents: 1 });
    await db.query('UPDATE admin_audit_events SET details = $2::jsonb WHERE id = $1', [event.id, JSON.stringify(event.details)]);
    await expect(control.verifyAudit()).resolves.toMatchObject({ valid: true });
  });

  it('serializes concurrent audit appends into one gap-free chain', async () => {
    await Promise.all(Array.from({ length: 10 }, (_, index) => control.setBudget({ tenantId: `control-audit-chain-${index}`, limitUsd: index + 1, actorCredentialId: 'control-admin', actorTenantId: 'platform' })));
    await expect(control.verifyAudit()).resolves.toMatchObject({ valid: true, checkedEvents: 10, headSequence: 10, headHash: expect.stringMatching(/^[0-9a-f]{64}$/u) });
  });

  it('backfills a valid chain over legacy audit rows during migration 016', async () => {
    const migration = await readFile('migrations/016_tamper_evident_audit.sql', 'utf8');
    await db.query('DROP SCHEMA IF EXISTS audit_backfill_test CASCADE');
    try {
      await db.transaction(async (tx) => {
        await tx.query('CREATE SCHEMA audit_backfill_test');
        await tx.query('SET LOCAL search_path TO audit_backfill_test, public');
        await tx.query("CREATE TABLE admin_audit_events (id UUID PRIMARY KEY, actor_credential_id TEXT NOT NULL, actor_tenant_id TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, details JSONB NOT NULL DEFAULT '{}'::jsonb, occurred_at TIMESTAMPTZ NOT NULL DEFAULT now())");
        await tx.query("INSERT INTO admin_audit_events (id, actor_credential_id, actor_tenant_id, action, target, details, occurred_at) VALUES ('00000000-0000-4000-8000-000000000001', 'legacy-a', 'platform', 'budget.set', 'tenant:a', '{\"limitUsd\":1}', '2026-01-01T00:00:00Z'), ('00000000-0000-4000-8000-000000000002', 'legacy-b', 'platform', 'budget.set', 'tenant:b', '{\"limitUsd\":2}', '2026-01-02T00:00:00Z')");
        await tx.query(migration);
        const rows = await tx.query<{ chain_sequence: string | number; previous_hash: string; event_hash: string }>('SELECT chain_sequence, previous_hash, event_hash FROM admin_audit_events ORDER BY chain_sequence');
        expect(rows.rows).toHaveLength(2);
        expect(Number(rows.rows[0]!.chain_sequence)).toBe(1);
        expect(rows.rows[0]!.previous_hash).toBe('0'.repeat(64));
        expect(rows.rows[0]!.event_hash).toMatch(/^[0-9a-f]{64}$/u);
        expect(Number(rows.rows[1]!.chain_sequence)).toBe(2);
        expect(rows.rows[1]!.previous_hash).toBe(rows.rows[0]!.event_hash);
        expect(rows.rows[1]!.event_hash).toMatch(/^[0-9a-f]{64}$/u);
      });
    } finally { await db.query('DROP SCHEMA IF EXISTS audit_backfill_test CASCADE'); }
  });

  it('serializes registry rollback and copies a prior snapshot with its audit event', async () => {
    const actor = { actorCredentialId: 'control-admin', actorTenantId: 'platform' };
    await control.submitEvidence({ modelId: defaultModels[0]!.id, modelVersion: defaultModels[0]!.version, suiteVersion: 'suite-1', datasetVersion: 'dataset-1', conformancePassed: true, pricingVerified: true, usageVerified: true, routingPassRate: 0.99, qualityScore: 0.9, sampleCount: 200, evaluatedAt: new Date(Date.now() - 60_000).toISOString(), expiresAt: new Date(Date.now() + 86_400_000).toISOString(), ...actor });
    const target = await control.publishModels({ models: defaultModels.slice(0, 1), source: 'rollback-target', ...actor });
    const current = await control.publishModels({ models: defaultModels.slice(0, 1), source: 'rollback-current', ...actor });
    const attempts = await Promise.allSettled([
      control.rollbackModels({ targetVersion: target.version, expectedCurrentVersion: current.version, reason: 'incident', ...actor }),
      control.rollbackModels({ targetVersion: target.version, expectedCurrentVersion: current.version, reason: 'duplicate incident command', ...actor }),
    ]);
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const restored = attempts.find((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof control.rollbackModels>>> => result.status === 'fulfilled')!.value;
    expect(restored).toMatchObject({ version: current.version + 1, source: `rollback:${target.version}`, models: target.models });
    await expect(control.listAudit(10)).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ action: 'models.rollback', target: `registry:${restored.version}`, details: expect.objectContaining({ targetVersion: target.version, previousVersion: current.version, reason: 'incident' }) })]));
  });

  it('serializes emergency model disable and preserves one enabled model', async () => {
    const actor = { actorCredentialId: 'control-admin', actorTenantId: 'platform' };
    for (const model of defaultModels) await control.submitEvidence({ modelId: model.id, modelVersion: model.version, suiteVersion: 'suite-1', datasetVersion: 'dataset-1', conformancePassed: true, pricingVerified: true, usageVerified: true, routingPassRate: 1, qualityScore: 1, sampleCount: 200, evaluatedAt: new Date(Date.now() - 60_000).toISOString(), expiresAt: new Date(Date.now() + 86_400_000).toISOString(), ...actor });
    const initial = await control.publishModels({ models: defaultModels, source: 'disable-initial', ...actor });
    const attempts = await Promise.allSettled([
      control.disableModel({ modelId: defaultModels[0]!.id, expectedCurrentVersion: initial.version, reason: 'incident-a', ...actor }),
      control.disableModel({ modelId: defaultModels[1]!.id, expectedCurrentVersion: initial.version, reason: 'incident-b', ...actor }),
    ]);
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const afterRace = attempts.find((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof control.disableModel>>> => result.status === 'fulfilled')!.value;
    expect(afterRace.models.filter((model) => model.enabled)).toHaveLength(2);
    const nextTarget = afterRace.models.find((model) => model.enabled)!;
    const oneLeft = await control.disableModel({ modelId: nextTarget.id, expectedCurrentVersion: afterRace.version, reason: 'second isolation', ...actor });
    expect(oneLeft.models.filter((model) => model.enabled)).toHaveLength(1);
    const last = oneLeft.models.find((model) => model.enabled)!;
    await expect(control.disableModel({ modelId: last.id, expectedCurrentVersion: oneLeft.version, reason: 'must fail closed', ...actor })).rejects.toMatchObject({ code: 'last_enabled_model', statusCode: 409 });
    const latest = await control.registrySnapshot(oneLeft.version);
    expect(latest?.models.filter((model) => model.enabled)).toHaveLength(1);
    expect((await control.listAudit(20)).filter((event) => event.action === 'models.disable')).toHaveLength(2);
  });

  it('serializes tenant policy updates and converges a running router without hot-path database reads', async () => {
    const actor = { actorCredentialId: 'control-admin', actorTenantId: 'platform' };
    const attempts = await Promise.allSettled([
      control.setTenantPolicy({ tenantId: 'control-policy-race', expectedVersion: 0, reason: 'race a', allowedModels: [defaultModels[0]!.id], ...actor }),
      control.setTenantPolicy({ tenantId: 'control-policy-race', expectedVersion: 0, reason: 'race b', allowedModels: [defaultModels[1]!.id], ...actor }),
    ]);
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((result) => result.status === 'rejected')).toHaveLength(1);
    await expect(control.tenantPolicy('control-policy-race')).resolves.toMatchObject({ version: 1 });

    const credentials = new PostgresCredentialStore(db);
    await credentials.createCredential({ id: 'control-policy-caller', tenantId: 'control-policy-live', keySha256: sha256ApiKey('control-policy-secret'), scopes: ['responses:create'], ...actor });
    const app = await buildApp({ host: '127.0.0.1', port: 0, logLevel: 'silent', environment: 'test', persistenceMode: 'postgres', databaseUrl: databaseUrl!, classifierMode: 'disabled', policyRefreshSeconds: 1 });
    try {
      const request = () => app.inject({ method: 'POST', url: '/v1/responses', headers: { authorization: 'Bearer control-policy-secret' }, payload: { model: defaultModels[0]!.id, messages: [{ role: 'user', content: 'policy convergence' }] } });
      expect((await request()).statusCode).toBe(200);
      await control.setTenantPolicy({ tenantId: 'control-policy-live', expectedVersion: 0, reason: 'restrict live router', allowedModels: [defaultModels[1]!.id], ...actor });
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      const rejected = await request();
      expect(rejected.statusCode).toBe(422);
      expect(rejected.json().error.code).toBe('no_eligible_model');
    } finally { await app.close(); }
    expect((await control.listAudit(20)).filter((event) => event.action === 'policy.set')).toHaveLength(2);
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

  it('creates, lists, and disables hashed credentials with last-admin protection', async () => {
    const credentials = new PostgresCredentialStore(db);
    const actor = { actorCredentialId: 'control-admin', actorTenantId: 'platform' };
    const first = await credentials.createCredential({ id: 'control-admin-a', tenantId: 'platform', keySha256: sha256ApiKey('control-admin-a-secret'), scopes: ['admin:write'], ...actor });
    await expect(credentials.createCredential({ id: 'control-admin-a', tenantId: 'platform', keySha256: sha256ApiKey('control-admin-a-secret'), scopes: ['admin:write'], ...actor })).resolves.toEqual(first);
    await credentials.createCredential({ id: 'control-admin-b', tenantId: 'platform', keySha256: sha256ApiKey('control-admin-b-secret'), scopes: ['admin:write'], ...actor });
    expect(first.keySha256).toBe(sha256ApiKey('control-admin-a-secret'));
    const concurrent = await Promise.allSettled([credentials.disableCredential({ id: 'control-admin-a', ...actor }), credentials.disableCredential({ id: 'control-admin-b', ...actor })]);
    expect(concurrent.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(concurrent.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const disabledId = concurrent[0]!.status === 'fulfilled' ? 'control-admin-a' : 'control-admin-b';
    await expect(credentials.disableCredential({ id: disabledId, ...actor })).resolves.toMatchObject({ id: disabledId, disabled: true });
    const listed = await credentials.listCredentials();
    expect(listed.filter((credential) => credential.scopes.includes('admin:write') && !credential.disabled)).toHaveLength(1);
    const audit = await control.listAudit(10);
    expect(audit).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'credential.create', target: 'credential:control-admin-a' }), expect.objectContaining({ action: 'credential.disable' })]));
  });

  it('paginates audit events without gaps across equal-time ordering ties', async () => {
    const actor = { actorCredentialId: 'control-admin', actorTenantId: 'platform' };
    for (let index = 0; index < 5; index += 1) await control.setBudget({ tenantId: `control-audit-${index}`, limitUsd: index + 1, ...actor });
    const first = await control.listAudit(2);
    const second = await control.listAudit(2, { id: first[1]!.id, occurredAt: first[1]!.occurredAt });
    const third = await control.listAudit(2, { id: second[1]!.id, occurredAt: second[1]!.occurredAt });
    const ids = [...first, ...second, ...third].filter((event) => event.actorCredentialId === 'control-admin').map((event) => event.id);
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
  });

  it('loads durable credentials at startup and converges on revocation without restart', async () => {
    const credentials = new PostgresCredentialStore(db);
    const actor = { actorCredentialId: 'control-admin', actorTenantId: 'platform' };
    await credentials.createCredential({ id: 'control-live-caller', tenantId: 'control-tenant', keySha256: sha256ApiKey('control-live-secret'), scopes: ['responses:create'], ...actor });
    const app = await buildApp({ host: '127.0.0.1', port: 0, logLevel: 'silent', environment: 'test', persistenceMode: 'postgres', databaseUrl: databaseUrl!, classifierMode: 'disabled', credentialRefreshSeconds: 1 });
    try {
      const request = () => app.inject({ method: 'POST', url: '/v1/responses', headers: { authorization: 'Bearer control-live-secret' }, payload: { messages: [{ role: 'user', content: 'hello' }] } });
      expect((await request()).statusCode).toBe(200);
      await credentials.disableCredential({ id: 'control-live-caller', ...actor });
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      expect((await request()).statusCode).toBe(401);
    } finally { await app.close(); }
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
    const storedRejection = await decisions.get('control-tenant', rejected.id);
    expect(storedRejection).toMatchObject({ state: 'rejected', attempts: [], rejection: { candidates: [{ reason: 'max_cost_exceeded' }] } });
    expect(storedRejection?.route).toBeUndefined();

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
