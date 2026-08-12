import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { sha256ApiKey } from '../src/security/auth.js';
import type { ProviderAdapter } from '../src/ports/provider.js';
import { defaultModels } from '../src/registry/default-models.js';
import { InMemoryMetrics } from '../src/observability/metrics.js';
import type { DecisionStore } from '../src/persistence/contracts.js';
import { InMemoryModelRegistry } from '../src/registry/memory-registry.js';
import { ProviderError } from '../src/domain/errors.js';
import type { DecisionRecord } from '../src/domain/types.js';

const base = { host: '127.0.0.1', port: 0, logLevel: 'silent', environment: 'test' as const, requestTimeoutMs: 60_000, providerMaxRetries: 0 };

describe('routing query APIs', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  it('persists a content-free completed decision and enforces tenant isolation', async () => {
    app = await buildApp({ ...base, apiCredentials: [
      { id: 'tenant-a', tenantId: 'tenant-a', keySha256: sha256ApiKey('tenant-a-key'), scopes: ['responses:create', 'routing:read'] },
      { id: 'tenant-b', tenantId: 'tenant-b', keySha256: sha256ApiKey('tenant-b-key'), scopes: ['routing:read'] },
    ] });
    const prompt = 'private-decision-prompt-42';
    const created = await app.inject({ method: 'POST', url: '/v1/responses', headers: { authorization: 'Bearer tenant-a-key' }, payload: { requestId: 'decision-42', messages: [{ role: 'user', content: prompt }] } });
    expect(created.statusCode).toBe(200);
    const found = await app.inject({ method: 'GET', url: '/v1/routing/decisions/decision-42', headers: { authorization: 'Bearer tenant-a-key' } });
    expect(found.statusCode).toBe(200);
    expect(found.json()).toMatchObject({ id: 'decision-42', tenantId: 'tenant-a', state: 'completed', outcome: { provider: 'simulator', status: 'completed' } });
    expect(found.body).not.toContain(prompt);
    expect(found.body).not.toContain('Simulated response');
    const isolated = await app.inject({ method: 'GET', url: '/v1/routing/decisions/decision-42', headers: { authorization: 'Bearer tenant-b-key' } });
    expect(isolated.statusCode).toBe(404);
  });

  it('simulates routing and lists visible models without invoking a provider', async () => {
    let providerCalls = 0;
    let classifierCalls = 0;
    const provider: ProviderAdapter = {
      name: 'simulator', listModels: () => defaultModels,
      complete: async () => { providerCalls += 1; throw new Error('simulation must not execute'); },
      stream: async function* () { providerCalls += 1; },
    };
    app = await buildApp({ ...base, classifierMode: 'degrade', apiCredentials: [{ id: 'reader', tenantId: 'tenant-a', keySha256: sha256ApiKey('reader-key'), scopes: ['routing:read'] }] }, { providers: [provider], classifier: { name: 'must-not-run', classify: async () => { classifierCalls += 1; throw new Error('simulation must not classify externally'); } } });
    const headers = { authorization: 'Bearer reader-key' };
    const simulated = await app.inject({ method: 'POST', url: '/v1/routing/simulate', headers, payload: { messages: [{ role: 'user', content: 'Route this without executing it' }] } });
    expect(simulated.statusCode).toBe(200);
    expect(simulated.json()).toMatchObject({ nonBinding: true, decision: { selected: { model: { id: expect.any(String) } } } });
    const models = await app.inject({ method: 'GET', url: '/v1/models', headers });
    expect(models.statusCode).toBe(200);
    expect(models.json().data).toHaveLength(defaultModels.length);
    expect(providerCalls).toBe(0);
    expect(classifierCalls).toBe(0);
  });

  it('requires routing read scope for query APIs', async () => {
    app = await buildApp({ ...base, apiCredentials: [{ id: 'writer', tenantId: 'tenant-a', keySha256: sha256ApiKey('writer-key'), scopes: ['responses:create'] }] });
    const denied = await app.inject({ method: 'GET', url: '/v1/models', headers: { authorization: 'Bearer writer-key' } });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('authorization_error');
  });

  it('fails before provider execution when the planned decision cannot be persisted', async () => {
    let providerCalls = 0;
    const provider: ProviderAdapter = {
      name: 'simulator', listModels: () => defaultModels,
      complete: async () => { providerCalls += 1; throw new Error('must not execute'); }, stream: async function* () {},
    };
    const decisions: DecisionStore = { save: async () => { throw new Error('store unavailable'); }, get: async () => undefined };
    app = await buildApp(base, { providers: [provider], decisions });
    const response = await app.inject({ method: 'POST', url: '/v1/responses', payload: { messages: [{ role: 'user', content: 'do not bill this' }] } });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('decision_store_error');
    expect(providerCalls).toBe(0);
  });

  it('preserves a successful provider result when only the terminal decision update fails', async () => {
    let writes = 0;
    const metrics = new InMemoryMetrics();
    const decisions: DecisionStore = { save: async () => { writes += 1; if (writes > 1) throw new Error('terminal write unavailable'); }, get: async () => undefined };
    app = await buildApp(base, { decisions, metrics });
    const response = await app.inject({ method: 'POST', url: '/v1/responses', payload: { messages: [{ role: 'user', content: 'complete despite telemetry failure' }] } });
    expect(response.statusCode).toBe(200);
    expect(metrics.snapshot().operational.decision_store_failure).toBe(1);
  });

  it('records the provider that actually served a streaming fallback', async () => {
    const first = { ...defaultModels[0]!, id: 'first', provider: 'first' };
    const second = { ...defaultModels[1]!, id: 'second', provider: 'second' };
    const records: DecisionRecord[] = [];
    const decisions: DecisionStore = { save: async (record) => { records.push(structuredClone(record)); }, get: async () => undefined };
    const providers: ProviderAdapter[] = [
      { name: 'first', listModels: () => [first], complete: async () => { throw new Error('unused'); }, stream: async function* () { throw new ProviderError('unavailable', true); } },
      { name: 'second', listModels: () => [second], complete: async () => { throw new Error('unused'); }, stream: async function* () { yield { requestId: 'stream-fallback', index: 0, delta: 'ok', done: false, type: 'text-delta' }; yield { requestId: 'stream-fallback', index: 1, delta: '', done: true, type: 'completed', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimatedCostUsd: 0 } }; } },
    ];
    app = await buildApp(base, { registry: new InMemoryModelRegistry([first, second]), providers, decisions });
    const response = await app.inject({ method: 'POST', url: '/v1/responses', payload: { requestId: 'stream-fallback', stream: true, messages: [{ role: 'user', content: 'hello' }] } });
    expect(response.statusCode).toBe(200);
    expect(records.at(-1)).toMatchObject({ state: 'completed', route: { selected: { model: { id: 'second' } } }, outcome: { provider: 'second', model: second.model } });
  });
});
