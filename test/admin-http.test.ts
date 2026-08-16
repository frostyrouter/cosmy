import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { defaultModels } from '../src/registry/default-models.js';
import { ReloadableApiKeyAuthenticator, sha256ApiKey } from '../src/security/auth.js';
import type { CredentialStore, ManagedApiCredential } from '../src/persistence/contracts.js';
import { InMemoryUsageLedger } from '../src/stores/memory-usage-ledger.js';

const adminKey = 'admin-secret';
const responseKey = 'response-secret';
const credentials = [
  { id: 'admin', tenantId: 'platform', keySha256: sha256ApiKey(adminKey), scopes: ['admin:write' as const] },
  { id: 'caller', tenantId: 'tenant-a', keySha256: sha256ApiKey(responseKey), scopes: ['responses:create' as const, 'routing:read' as const] },
];
const config = { host: '127.0.0.1', port: 0, logLevel: 'silent', environment: 'test' as const, requestTimeoutMs: 60_000, providerMaxRetries: 0, apiCredentials: credentials };

describe('administrative HTTP API', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  it('requires administrative credentials and scopes', async () => {
    app = await buildApp(config);
    const missing = await app.inject({ method: 'GET', url: '/v1/admin/models' });
    const ordinary = await app.inject({ method: 'GET', url: '/v1/admin/models', headers: { authorization: `Bearer ${responseKey}` } });
    const admin = await app.inject({ method: 'GET', url: '/v1/admin/models', headers: { authorization: `Bearer ${adminKey}` } });
    expect(missing.statusCode).toBe(401);
    expect(ordinary.statusCode).toBe(403);
    expect(admin.statusCode).toBe(200);
    expect(admin.json().models.length).toBeGreaterThan(0);
    const diagnostics = await app.inject({ method: 'GET', url: '/v1/admin/diagnostics', headers: { authorization: `Bearer ${adminKey}` } });
    expect(diagnostics.statusCode).toBe(200);
    expect(diagnostics.json()).toMatchObject({ status: 'ready', persistence: 'memory', registry: { modelCount: 3, enabledModelCount: 3 } });
  });

  it('creates and disables a redacted credential without restarting', async () => {
    const stored: ManagedApiCredential[] = [];
    const credentialStore: CredentialStore = {
      listCredentials: async () => structuredClone(stored),
      createCredential: async (input) => {
        const now = new Date().toISOString();
        const created = { id: input.id, tenantId: input.tenantId, keySha256: input.keySha256, scopes: [...input.scopes], createdAt: now, updatedAt: now };
        stored.push(created); return structuredClone(created);
      },
      disableCredential: async (input) => {
        const found = stored.find((entry) => entry.id === input.id)!; found.disabled = true; found.updatedAt = new Date().toISOString(); return structuredClone(found);
      },
    };
    const authenticator = new ReloadableApiKeyAuthenticator(credentials);
    app = await buildApp(config, { authenticator, credentials: credentialStore });
    const headers = { authorization: `Bearer ${adminKey}` };
    const created = await app.inject({ method: 'POST', url: '/v1/admin/credentials', headers, payload: { id: 'rotated-caller', tenantId: 'tenant-b', keySha256: sha256ApiKey('rotated-secret'), scopes: ['responses:create'] } });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ id: 'rotated-caller', tenantId: 'tenant-b', scopes: ['responses:create'] });
    expect(created.body).not.toContain(sha256ApiKey('rotated-secret'));
    const accepted = await app.inject({ method: 'POST', url: '/v1/responses', headers: { authorization: 'Bearer rotated-secret' }, payload: { messages: [{ role: 'user', content: 'hello' }] } });
    expect(accepted.statusCode).toBe(200);
    const listed = await app.inject({ method: 'GET', url: '/v1/admin/credentials', headers });
    expect(listed.body).not.toContain(sha256ApiKey('rotated-secret'));
    const disabled = await app.inject({ method: 'POST', url: '/v1/admin/credentials/rotated-caller/disable', headers });
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json()).toMatchObject({ id: 'rotated-caller', disabled: true });
    const rejected = await app.inject({ method: 'POST', url: '/v1/responses', headers: { authorization: 'Bearer rotated-secret' }, payload: { messages: [{ role: 'user', content: 'hello' }] } });
    expect(rejected.statusCode).toBe(401);
  });

  it('publishes validated model snapshots and records an audit event', async () => {
    app = await buildApp(config);
    const headers = { authorization: `Bearer ${adminKey}` };
    const publish = await app.inject({ method: 'PUT', url: '/v1/admin/models', headers, payload: { source: 'operator:test', models: [defaultModels[0]] } });
    expect(publish.statusCode).toBe(200);
    expect(publish.json()).toMatchObject({ source: 'operator:test', models: [{ id: defaultModels[0]!.id }] });
    const audit = await app.inject({ method: 'GET', url: '/v1/admin/audit?limit=10', headers });
    expect(audit.json().events[0]).toMatchObject({ actorCredentialId: 'admin', action: 'models.publish', details: { modelCount: 1 } });
  });

  it('atomically rolls back to a durable registry version with optimistic concurrency', async () => {
    app = await buildApp(config);
    const headers = { authorization: `Bearer ${adminKey}` };
    const initial = await app.inject({ method: 'GET', url: '/v1/admin/models', headers });
    const targetVersion = initial.json().version as number;
    const published = await app.inject({ method: 'PUT', url: '/v1/admin/models', headers, payload: { source: 'reduced-registry', models: [defaultModels[0]] } });
    const currentVersion = published.json().version as number;
    const missingPrecondition = await app.inject({ method: 'POST', url: '/v1/admin/models/rollback', headers, payload: { targetVersion, reason: 'restore full registry' } });
    expect(missingPrecondition.statusCode).toBe(428);
    const malformedPrecondition = await app.inject({ method: 'POST', url: '/v1/admin/models/rollback', headers: { ...headers, 'if-match': `"${currentVersion}` }, payload: { targetVersion, reason: 'restore full registry' } });
    expect(malformedPrecondition.statusCode).toBe(428);
    const rolledBack = await app.inject({ method: 'POST', url: '/v1/admin/models/rollback', headers: { ...headers, 'if-match': `"${currentVersion}"` }, payload: { targetVersion, reason: 'restore full registry' } });
    expect(rolledBack.statusCode).toBe(200);
    expect(rolledBack.json()).toMatchObject({ version: currentVersion + 1, source: `rollback:${targetVersion}` });
    expect(rolledBack.json().models).toHaveLength(defaultModels.length);
    const staleRetry = await app.inject({ method: 'POST', url: '/v1/admin/models/rollback', headers: { ...headers, 'if-match': `${currentVersion}` }, payload: { targetVersion, reason: 'retry after lost response' } });
    expect(staleRetry.statusCode).toBe(409);
    expect(staleRetry.json().error.code).toBe('registry_version_conflict');
    const audit = await app.inject({ method: 'GET', url: '/v1/admin/audit?limit=10', headers });
    expect(audit.json().events).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'models.rollback', details: expect.objectContaining({ targetVersion, previousVersion: currentVersion, reason: 'restore full registry' }) })]));
  });

  it('emergency-disables a model without permitting stale commands or disabling the last model', async () => {
    app = await buildApp(config);
    const headers = { authorization: `Bearer ${adminKey}` };
    const disable = (modelId: string, version: number, reason: string) => app!.inject({ method: 'POST', url: '/v1/admin/models/disable', headers: { ...headers, 'if-match': `${version}` }, payload: { modelId, reason } });
    const first = await disable(defaultModels[0]!.id, 1, 'elevated provider errors');
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ version: 2, source: `disable:${defaultModels[0]!.id}` });
    expect(first.json().models.find((model: { id: string }) => model.id === defaultModels[0]!.id).enabled).toBe(false);
    const idempotent = await disable(defaultModels[0]!.id, 2, 'duplicate command');
    expect(idempotent.json().version).toBe(2);
    const stale = await disable(defaultModels[1]!.id, 1, 'stale operator view');
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('registry_version_conflict');
    const second = await disable(defaultModels[1]!.id, 2, 'continued incident');
    expect(second.json().version).toBe(3);
    const last = await disable(defaultModels[2]!.id, 3, 'unsafe command');
    expect(last.statusCode).toBe(409);
    expect(last.json().error.code).toBe('last_enabled_model');
    const routed = await app.inject({ method: 'POST', url: '/v1/responses', headers: { authorization: `Bearer ${responseKey}` }, payload: { model: defaultModels[0]!.id, messages: [{ role: 'user', content: 'must not run on disabled model' }] } });
    expect(routed.statusCode).toBe(422);
    expect(routed.json().error.code).toBe('no_eligible_model');
    const audit = await app.inject({ method: 'GET', url: '/v1/admin/audit?limit=10', headers });
    expect(audit.json().events.filter((event: { action: string }) => event.action === 'models.disable')).toHaveLength(2);
  });

  it('pages through the complete audit history with an opaque stable cursor', async () => {
    app = await buildApp(config);
    const headers = { authorization: `Bearer ${adminKey}` };
    for (let index = 0; index < 5; index += 1) {
      const mutation = await app.inject({ method: 'PUT', url: `/v1/admin/tenants/audit-${index}/budget`, headers, payload: { limitUsd: index + 1 } });
      expect(mutation.statusCode).toBe(200);
    }
    const first = await app.inject({ method: 'GET', url: '/v1/admin/audit?limit=2', headers });
    expect(first.statusCode).toBe(200);
    expect(first.json().events).toHaveLength(2);
    expect(first.json().nextCursor).toEqual(expect.any(String));
    const second = await app.inject({ method: 'GET', url: `/v1/admin/audit?limit=2&cursor=${first.json().nextCursor}`, headers });
    const third = await app.inject({ method: 'GET', url: `/v1/admin/audit?limit=2&cursor=${second.json().nextCursor}`, headers });
    const all = [...first.json().events, ...second.json().events, ...third.json().events];
    expect(new Set(all.map((event: { id: string }) => event.id)).size).toBe(5);
    expect(third.json()).toMatchObject({ nextCursor: null });
    const malformed = await app.inject({ method: 'GET', url: '/v1/admin/audit?cursor=not%2Bbase64', headers });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().error.code).toBe('invalid_request');
  });

  it('reports the administrative audit-chain verification state', async () => {
    app = await buildApp(config);
    const headers = { authorization: `Bearer ${adminKey}` };
    const verification = await app.inject({ method: 'GET', url: '/v1/admin/audit/verify', headers });
    expect(verification.statusCode).toBe(200);
    expect(verification.json()).toMatchObject({ valid: true, checkedEvents: 0, headSequence: null, headHash: null });
  });

  it('sets a tenant budget that is enforced on the response path', async () => {
    app = await buildApp(config);
    const adminHeaders = { authorization: `Bearer ${adminKey}` };
    const updated = await app.inject({ method: 'PUT', url: '/v1/admin/tenants/tenant-a/budget', headers: adminHeaders, payload: { limitUsd: 0.00000001 } });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ tenantId: 'tenant-a', limitUsd: 0.00000001 });
    const blocked = await app.inject({ method: 'POST', url: '/v1/responses', headers: { authorization: `Bearer ${responseKey}` }, payload: { messages: [{ role: 'user', content: 'this request exceeds the tiny budget' }] } });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe('budget_exceeded');
    const audit = await app.inject({ method: 'GET', url: '/v1/admin/audit', headers: adminHeaders });
    expect(audit.json().events[0]).toMatchObject({ action: 'budget.set', target: 'tenant:tenant-a' });
  });

  it('creates a versioned tenant policy that callers can tighten but never relax', async () => {
    app = await buildApp(config);
    const adminHeaders = { authorization: `Bearer ${adminKey}`, 'if-match': '0', 'x-change-reason': 'establish tenant boundary' };
    const missingReason = await app.inject({ method: 'PUT', url: '/v1/admin/tenants/tenant-a/policy', headers: { authorization: `Bearer ${adminKey}`, 'if-match': '0' }, payload: { allowedModels: [defaultModels[0]!.id] } });
    expect(missingReason.statusCode).toBe(428);
    const created = await app.inject({ method: 'PUT', url: '/v1/admin/tenants/tenant-a/policy', headers: adminHeaders, payload: { allowedModels: [defaultModels[0]!.id], allowedDataClasses: ['public', 'internal'], maxCostUsd: 1, allowFallback: false } });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({ tenantId: 'tenant-a', version: 1, allowedModels: [defaultModels[0]!.id], allowFallback: false });
    const stale = await app.inject({ method: 'PUT', url: '/v1/admin/tenants/tenant-a/policy', headers: adminHeaders, payload: { allowedModels: [defaultModels[1]!.id] } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('policy_version_conflict');
    const read = await app.inject({ method: 'GET', url: '/v1/admin/tenants/tenant-a/policy', headers: { authorization: `Bearer ${adminKey}` } });
    expect(read.json()).toMatchObject({ version: 1, allowedModels: [defaultModels[0]!.id] });
    const models = await app.inject({ method: 'GET', url: '/v1/models', headers: { authorization: `Bearer ${responseKey}` } });
    expect(models.json().data.map((model: { id: string }) => model.id)).toEqual([defaultModels[0]!.id]);
    const allowed = await app.inject({ method: 'POST', url: '/v1/responses', headers: { authorization: `Bearer ${responseKey}` }, payload: { model: defaultModels[0]!.id, messages: [{ role: 'user', content: 'allowed request' }] } });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().route.policyVersion).toContain('tenant-1');
    const relaxed = await app.inject({ method: 'POST', url: '/v1/responses', headers: { authorization: `Bearer ${responseKey}` }, payload: { model: defaultModels[1]!.id, messages: [{ role: 'user', content: 'cannot relax allowlist' }], policy: { allowedModels: [defaultModels[1]!.id] } } });
    expect(relaxed.statusCode).toBe(422);
    expect(relaxed.json().error.code).toBe('no_eligible_model');
    const dataClass = await app.inject({ method: 'POST', url: '/v1/responses', headers: { authorization: `Bearer ${responseKey}` }, payload: { messages: [{ role: 'user', content: 'restricted request' }], policy: { dataClass: 'restricted' } } });
    expect(dataClass.statusCode).toBe(422);
    expect(dataClass.json().error.code).toBe('policy_rejection');
    const audit = await app.inject({ method: 'GET', url: '/v1/admin/audit?limit=10', headers: { authorization: `Bearer ${adminKey}` } });
    expect(audit.json().events).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'policy.set', target: 'tenant:tenant-a', details: { version: 1, reason: 'establish tenant boundary' } })]));
  });

  it('returns 409 when a memory limit is below current usage', async () => {
    const usage = new InMemoryUsageLedger();
    await usage.reserve({ tenantId: 'tenant-a', estimatedCostUsd: 0.01 });
    app = await buildApp(config, { usage });
    const response = await app.inject({ method: 'PUT', url: '/v1/admin/tenants/tenant-a/budget', headers: { authorization: `Bearer ${adminKey}` }, payload: { limitUsd: 0.005 } });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('budget_below_usage');
  });

  it('rejects malformed manifests and tenant identifiers', async () => {
    app = await buildApp(config);
    const headers = { authorization: `Bearer ${adminKey}` };
    const manifest = await app.inject({ method: 'PUT', url: '/v1/admin/models', headers, payload: { source: 'bad', models: [{ id: 'incomplete' }] } });
    const tenant = await app.inject({ method: 'GET', url: '/v1/admin/tenants/invalid tenant/budget', headers });
    expect(manifest.statusCode).toBe(400);
    expect(tenant.statusCode).toBe(400);
  });

  it('rejects enabled models whose provider is unavailable', async () => {
    app = await buildApp(config);
    const model = structuredClone(defaultModels[0]!);
    model.provider = 'not-configured';
    const response = await app.inject({ method: 'PUT', url: '/v1/admin/models', headers: { authorization: `Bearer ${adminKey}` }, payload: { source: 'bad-provider', models: [model] } });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('unavailable provider');
  });

  it('requires fresh evidence before enabling a new model version', async () => {
    app = await buildApp(config);
    const headers = { authorization: `Bearer ${adminKey}` };
    const model = { ...structuredClone(defaultModels[0]!), id: 'sim/candidate', version: '2' };
    const publish = () => app!.inject({ method: 'PUT', url: '/v1/admin/models', headers, payload: { source: 'promotion-test', models: [...defaultModels, model] } });
    const missing = await publish();
    expect(missing.statusCode).toBe(409);
    expect(missing.json().error.code).toBe('promotion_gate_failed');
    const failedEvidence = await app.inject({ method: 'POST', url: '/v1/admin/model-evidence', headers, payload: {
      modelId: model.id, modelVersion: model.version, suiteVersion: 'routing-v1', datasetVersion: 'too-small-v1', conformancePassed: true,
      pricingVerified: true, usageVerified: true, routingPassRate: 0.99, qualityScore: 0.9, sampleCount: 10,
      evaluatedAt: new Date(Date.now() - 120_000).toISOString(), expiresAt: new Date(Date.now() - 60_000).toISOString(),
    } });
    expect(failedEvidence.statusCode).toBe(201);
    const failedAssessment = await app.inject({ method: 'POST', url: '/v1/admin/model-promotion-assessments', headers, payload: model });
    expect(failedAssessment.json()).toMatchObject({ eligible: false, reasons: ['sample_count_below_gate', 'evidence_expired'] });
    expect((await publish()).statusCode).toBe(409);
    const evidence = await app.inject({ method: 'POST', url: '/v1/admin/model-evidence', headers, payload: {
      modelId: model.id, modelVersion: model.version, suiteVersion: 'routing-v1', datasetVersion: 'standard-v1', conformancePassed: true,
      pricingVerified: true, usageVerified: true, routingPassRate: 0.99, qualityScore: 0.9, sampleCount: 200,
      evaluatedAt: new Date(Date.now() - 60_000).toISOString(), expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    } });
    expect(evidence.statusCode).toBe(201);
    const assessment = await app.inject({ method: 'POST', url: '/v1/admin/model-promotion-assessments', headers, payload: model });
    expect(assessment.json()).toMatchObject({ required: true, eligible: true, reasons: [] });
    expect((await publish()).statusCode).toBe(200);
    const read = await app.inject({ method: 'GET', url: `/v1/admin/model-evidence?modelId=${encodeURIComponent(model.id)}&modelVersion=${encodeURIComponent(model.version)}`, headers });
    expect(read.json()).toMatchObject({ modelId: model.id, modelVersion: model.version, submittedByCredentialId: 'admin' });
  });

  it('rejects material changes that reuse an enabled model version', async () => {
    app = await buildApp(config);
    const model = structuredClone(defaultModels[0]!);
    model.pricing.outputPerMillionUsd += 1;
    const response = await app.inject({ method: 'PUT', url: '/v1/admin/models', headers: { authorization: `Bearer ${adminKey}` }, payload: { source: 'version-reuse', models: [model, ...defaultModels.slice(1)] } });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('model_version_conflict');
  });

  it('starts, reads, and rolls back an audited canary rollout', async () => {
    app = await buildApp(config);
    const headers = { authorization: `Bearer ${adminKey}` };
    const created = await app.inject({ method: 'POST', url: '/v1/admin/model-rollouts', headers, payload: { modelId: defaultModels[0]!.id, modelVersion: defaultModels[0]!.version, trafficPercentage: 10, minimumSamples: 20, maximumErrorRate: 0.05, maximumAverageLatencyMs: 2_000 } });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ state: 'canary', trafficPercentage: 10, sampleCount: 0 });
    const read = await app.inject({ method: 'GET', url: `/v1/admin/model-rollouts/${created.json().id}`, headers });
    expect(read.json()).toMatchObject({ id: created.json().id, state: 'canary' });
    const premature = await app.inject({ method: 'POST', url: '/v1/admin/model-rollout-actions', headers, payload: { id: created.json().id, action: 'promote' } });
    expect(premature.statusCode).toBe(409);
    expect(premature.json().error.code).toBe('rollout_not_ready');
    const rolledBack = await app.inject({ method: 'POST', url: '/v1/admin/model-rollout-actions', headers, payload: { id: created.json().id, action: 'rollback', reason: 'operator stopped canary' } });
    expect(rolledBack.json()).toMatchObject({ state: 'rolled_back', reason: 'operator stopped canary' });
    const audit = await app.inject({ method: 'GET', url: '/v1/admin/audit?limit=10', headers });
    expect(audit.json().events.map((event: { action: string }) => event.action)).toEqual(expect.arrayContaining(['rollout.start', 'rollout.rollback']));
  });

  it('manages a separately budgeted public/internal shadow campaign', async () => {
    app = await buildApp(config); const headers = { authorization: `Bearer ${adminKey}` };
    const created = await app.inject({ method: 'POST', url: '/v1/admin/shadow-campaigns', headers, payload: { modelId: defaultModels[1]!.id, modelVersion: defaultModels[1]!.version, samplePercentage: 5, budgetLimitUsd: 10, allowedDataClasses: ['public', 'internal'] } });
    expect(created.statusCode).toBe(201); expect(created.json()).toMatchObject({ state: 'active', reservedUsd: 0, spentUsd: 0 });
    const rejected = await app.inject({ method: 'POST', url: '/v1/admin/shadow-campaigns', headers, payload: { modelId: defaultModels[2]!.id, modelVersion: defaultModels[2]!.version, samplePercentage: 5, budgetLimitUsd: 10, allowedDataClasses: ['confidential'] } });
    expect(rejected.statusCode).toBe(400);
    const paused = await app.inject({ method: 'POST', url: '/v1/admin/shadow-campaign-actions', headers, payload: { id: created.json().id, action: 'pause' } }); expect(paused.json().state).toBe('paused');
    const resumed = await app.inject({ method: 'POST', url: '/v1/admin/shadow-campaign-actions', headers, payload: { id: created.json().id, action: 'resume' } }); expect(resumed.json().state).toBe('active');
    const completed = await app.inject({ method: 'POST', url: '/v1/admin/shadow-campaign-actions', headers, payload: { id: created.json().id, action: 'complete' } }); expect(completed.json().state).toBe('completed');
  });

  it('runs an eligible shadow asynchronously without changing the primary response', async () => {
    app = await buildApp(config); const adminHeaders = { authorization: `Bearer ${adminKey}` };
    const created = await app.inject({ method: 'POST', url: '/v1/admin/shadow-campaigns', headers: adminHeaders, payload: { modelId: defaultModels[1]!.id, modelVersion: defaultModels[1]!.version, samplePercentage: 100, budgetLimitUsd: 10, allowedDataClasses: ['internal'] } });
    const primary = await app.inject({ method: 'POST', url: '/v1/responses', headers: { authorization: `Bearer ${responseKey}` }, payload: { messages: [{ role: 'user', content: 'rewrite this email' }] } });
    expect(primary.statusCode).toBe(200); expect(primary.json().route.selected.model.id).toBe(defaultModels[0]!.id);
    let campaign = created.json(); const deadline = Date.now() + 1_000;
    while (campaign.sampleCount === 0 && Date.now() < deadline) { await new Promise((resolve) => setTimeout(resolve, 10)); campaign = (await app.inject({ method: 'GET', url: `/v1/admin/shadow-campaigns/${created.json().id}`, headers: adminHeaders })).json(); }
    expect(campaign).toMatchObject({ sampleCount: 1, successCount: 1, errorCount: 0, reservedUsd: 0 });
  });
});
