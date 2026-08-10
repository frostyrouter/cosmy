import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { defaultModels } from '../src/registry/default-models.js';
import { sha256ApiKey } from '../src/security/auth.js';
import { InMemoryUsageLedger } from '../src/stores/memory-usage-ledger.js';

const adminKey = 'admin-secret';
const responseKey = 'response-secret';
const credentials = [
  { id: 'admin', tenantId: 'platform', keySha256: sha256ApiKey(adminKey), scopes: ['admin:write' as const] },
  { id: 'caller', tenantId: 'tenant-a', keySha256: sha256ApiKey(responseKey), scopes: ['responses:create' as const] },
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

  it('publishes validated model snapshots and records an audit event', async () => {
    app = await buildApp(config);
    const headers = { authorization: `Bearer ${adminKey}` };
    const publish = await app.inject({ method: 'PUT', url: '/v1/admin/models', headers, payload: { source: 'operator:test', models: [defaultModels[0]] } });
    expect(publish.statusCode).toBe(200);
    expect(publish.json()).toMatchObject({ source: 'operator:test', models: [{ id: defaultModels[0]!.id }] });
    const audit = await app.inject({ method: 'GET', url: '/v1/admin/audit?limit=10', headers });
    expect(audit.json().events[0]).toMatchObject({ actorCredentialId: 'admin', action: 'models.publish', details: { modelCount: 1 } });
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
});
