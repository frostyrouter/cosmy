import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { InMemoryResponseCache } from '../src/persistence/memory-cache.js';
import { sha256ApiKey } from '../src/security/auth.js';
import { SimulatorProvider } from '../src/providers/simulator.js';
import { defaultModels } from '../src/registry/default-models.js';

describe('HTTP API', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => { await app?.close(); app = undefined; });

  it('returns a normalized completion with routing and usage metadata', async () => {
    app = await buildApp({ host: '127.0.0.1', port: 0, logLevel: 'silent', environment: 'test', requestTimeoutMs: 60_000, providerMaxRetries: 0 });
    const response = await app.inject({ method: 'POST', url: '/v1/responses', payload: { messages: [{ role: 'user', content: 'Rewrite this email politely' }] } });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('completed');
    expect(body.output).toContain('Rewritten');
    expect(body.route.selected.model.id).toBeTruthy();
    expect(body.usage.totalTokens).toBeGreaterThan(0);
    expect(body.usage.totalTokens).toBe(body.usage.inputTokens + body.usage.outputTokens);
  });

  it('does not treat a normally completed HTTP request as cancelled', async () => {
    app = await buildApp({ host: '127.0.0.1', port: 0, logLevel: 'silent', environment: 'test', requestTimeoutMs: 60_000, providerMaxRetries: 0 });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP listener');
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hello over HTTP' }] }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe('completed');
  });

  it('serves repeated completions from the configured response cache', async () => {
    const cache = new InMemoryResponseCache();
    app = await buildApp({ host: '127.0.0.1', port: 0, logLevel: 'silent', environment: 'test', requestTimeoutMs: 60_000, providerMaxRetries: 0, cacheMode: 'memory', responseCacheTtlSeconds: 60 }, { cache });
    const payload = { messages: [{ role: 'user', content: 'cache this response' }] };
    const first = await app.inject({ method: 'POST', url: '/v1/responses', payload });
    const second = await app.inject({ method: 'POST', url: '/v1/responses', payload });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json().output).toBe(first.json().output);
    expect(second.json().requestId).not.toBe(first.json().requestId);
  });

  it('rejects unknown request fields and invalid messages', async () => {
    app = await buildApp({ host: '127.0.0.1', port: 0, logLevel: 'silent', environment: 'test', requestTimeoutMs: 60_000, providerMaxRetries: 0 });
    const response = await app.inject({ method: 'POST', url: '/v1/responses', payload: { messages: [], unexpected: true } });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('invalid_request');
  });

  it('replays a completed idempotent request and rejects key reuse', async () => {
    app = await buildApp({ host: '127.0.0.1', port: 0, logLevel: 'silent', environment: 'test', requestTimeoutMs: 60_000, providerMaxRetries: 0 });
    const headers = { 'idempotency-key': 'checkout-42' };
    const payload = { messages: [{ role: 'user', content: 'perform this once' }] };
    const first = await app.inject({ method: 'POST', url: '/v1/responses', headers, payload });
    const replay = await app.inject({ method: 'POST', url: '/v1/responses', headers, payload });
    const conflict = await app.inject({ method: 'POST', url: '/v1/responses', headers, payload: { messages: [{ role: 'user', content: 'different operation' }] } });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(first.json());
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe('idempotency_conflict');
  });

  it('treats equivalent object key order as the same idempotent request', async () => {
    app = await buildApp({ host: '127.0.0.1', port: 0, logLevel: 'silent', environment: 'test', requestTimeoutMs: 60_000, providerMaxRetries: 0 });
    const headers = { 'idempotency-key': 'canonical-1' };
    const first = await app.inject({ method: 'POST', url: '/v1/responses', headers, payload: { temperature: 0, messages: [{ role: 'user', content: 'same request' }] } });
    const replay = await app.inject({ method: 'POST', url: '/v1/responses', headers, payload: { messages: [{ content: 'same request', role: 'user' }], temperature: 0 } });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(first.json());
  });

  it('keeps the claim when persisting a successful result fails', async () => {
    let releases = 0;
    const idempotency = {
      claim: async () => ({ status: 'claimed' as const }),
      complete: async () => { throw new Error('database unavailable'); },
      release: async () => { releases += 1; },
    };
    app = await buildApp({ host: '127.0.0.1', port: 0, logLevel: 'silent', environment: 'test', requestTimeoutMs: 60_000, providerMaxRetries: 0 }, { idempotency });
    const response = await app.inject({ method: 'POST', url: '/v1/responses', headers: { 'idempotency-key': 'store-failure' }, payload: { messages: [{ role: 'user', content: 'bill once' }] } });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('idempotency_store_error');
    expect(releases).toBe(0);
  });

  it('blocks concurrent duplicate execution', async () => {
    app = await buildApp({ host: '127.0.0.1', port: 0, logLevel: 'silent', environment: 'test', requestTimeoutMs: 60_000, providerMaxRetries: 0 }, { providers: [new SimulatorProvider(defaultModels, 50)] });
    const request = { method: 'POST' as const, url: '/v1/responses', headers: { 'idempotency-key': 'concurrent-1' }, payload: { messages: [{ role: 'user', content: 'run slowly' }] } };
    const first = app.inject(request);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const duplicate = await app.inject(request);
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe('idempotency_in_progress');
    expect((await first).statusCode).toBe(200);
  });

  it('validates idempotency keys and rejects them for streams', async () => {
    app = await buildApp({ host: '127.0.0.1', port: 0, logLevel: 'silent', environment: 'test', requestTimeoutMs: 60_000, providerMaxRetries: 0 });
    const invalid = await app.inject({ method: 'POST', url: '/v1/responses', headers: { 'idempotency-key': 'contains spaces' }, payload: { messages: [{ role: 'user', content: 'hello' }] } });
    const stream = await app.inject({ method: 'POST', url: '/v1/responses', headers: { 'idempotency-key': 'stream-1' }, payload: { stream: true, messages: [{ role: 'user', content: 'hello' }] } });
    expect(invalid.statusCode).toBe(400);
    expect(stream.statusCode).toBe(400);
  });

  it('caches only deterministic, non-sensitive requests', async () => {
    const stored: string[] = [];
    const cache = {
      get: async () => undefined,
      set: async (key: string) => { stored.push(key); },
      delete: async () => undefined,
    };
    app = await buildApp({ host: '127.0.0.1', port: 0, logLevel: 'silent', environment: 'test', requestTimeoutMs: 60_000, providerMaxRetries: 0, responseCacheTtlSeconds: 60 }, { cache });
    const post = (payload: object) => app!.inject({ method: 'POST', url: '/v1/responses', payload });
    await post({ temperature: 0, policy: { dataClass: 'public' }, messages: [{ role: 'user', content: 'safe cache' }] });
    await post({ temperature: 1, policy: { dataClass: 'public' }, messages: [{ role: 'user', content: 'creative' }] });
    await post({ model: 'sim-frontier', temperature: 0, policy: { dataClass: 'confidential' }, messages: [{ role: 'user', content: 'secret' }] });
    await post({ model: 'sim-balanced', temperature: 0, tools: [{ name: 'lookup', inputSchema: {} }], messages: [{ role: 'user', content: 'use tool' }] });
    expect(stored).toHaveLength(1);
  });

  it('rejects tool definitions without an input schema locally', async () => {
    app = await buildApp({ host: '127.0.0.1', port: 0, logLevel: 'silent', environment: 'test', requestTimeoutMs: 60_000, providerMaxRetries: 0 });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/responses',
      payload: { messages: [{ role: 'user', content: 'Use the lookup tool' }], tools: [{ name: 'lookup' }] },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('invalid_request');
  });

  it('returns 400 for malformed JSON bodies instead of 500', async () => {
    app = await buildApp({ host: '127.0.0.1', port: 0, logLevel: 'silent', environment: 'test', requestTimeoutMs: 60_000, providerMaxRetries: 0 });
    const response = await app.inject({ method: 'POST', url: '/v1/responses', payload: '{not json', headers: { 'content-type': 'application/json' } });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('invalid_request');
  });

  it('serves stream chunks as SSE events', async () => {
    app = await buildApp({ host: '127.0.0.1', port: 0, logLevel: 'silent', environment: 'test', requestTimeoutMs: 60_000, providerMaxRetries: 0 });
    const response = await app.inject({ method: 'POST', url: '/v1/responses', payload: { stream: true, messages: [{ role: 'user', content: 'hello world' }] } });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.body).toContain('event: done');
  });

  it('reports unready when the readiness check fails', async () => {
    const { default: Fastify } = await import('fastify');
    const { registerRoutes } = await import('../src/api/http.js');
    const service = { complete: async () => { throw new Error('unused'); }, stream: async function* () {} } as unknown as import('../src/service/router-service.js').RouterService;
    const bare = Fastify({ logger: false });
    registerRoutes(bare, service, async () => false);
    const response = await bare.inject({ method: 'GET', url: '/readyz' });
    expect(response.statusCode).toBe(503);
    await bare.close();
  });

  it('requires the API key on responses but not on health probes', async () => {
    app = await buildApp({ host: '127.0.0.1', port: 0, logLevel: 'silent', environment: 'test', requestTimeoutMs: 60_000, providerMaxRetries: 0, apiKey: 'sekret' });
    const denied = await app.inject({ method: 'POST', url: '/v1/responses', payload: { messages: [{ role: 'user', content: 'hello' }] } });
    expect(denied.statusCode).toBe(401);
    expect(denied.json().error.code).toBe('authentication_error');
    const allowed = await app.inject({ method: 'POST', url: '/v1/responses', headers: { authorization: 'Bearer sekret' }, payload: { messages: [{ role: 'user', content: 'hello' }] } });
    expect(allowed.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
  });

  it('derives billing tenant from a hashed scoped credential', async () => {
    const reservedFor: string[] = [];
    const usage: import('../src/ports/stores.js').UsageLedger = {
      reserve: async ({ tenantId, estimatedCostUsd }) => { reservedFor.push(tenantId); return { id: 'reservation', tenantId, estimatedCostUsd }; },
      reconcile: async () => {},
    };
    app = await buildApp(
      { host: '127.0.0.1', port: 0, logLevel: 'silent', environment: 'test', requestTimeoutMs: 60_000, providerMaxRetries: 0, apiCredentials: [{ id: 'project-a', tenantId: 'tenant-a', keySha256: sha256ApiKey('tenant-secret'), scopes: ['responses:create'] }] },
      { usage },
    );
    const response = await app.inject({ method: 'POST', url: '/v1/responses', headers: { authorization: 'Bearer tenant-secret' }, payload: { messages: [{ role: 'user', content: 'hello' }] } });
    expect(response.statusCode).toBe(200);
    expect(reservedFor).toEqual(['tenant-a']);
  });

  it('rejects caller-controlled tenant identities and missing scopes', async () => {
    const base = { host: '127.0.0.1', port: 0, logLevel: 'silent', environment: 'test' as const, requestTimeoutMs: 60_000, providerMaxRetries: 0 };
    app = await buildApp({ ...base, apiCredentials: [{ id: 'project-a', tenantId: 'tenant-a', keySha256: sha256ApiKey('tenant-secret'), scopes: ['responses:create'] }] });
    const mismatch = await app.inject({ method: 'POST', url: '/v1/responses', headers: { authorization: 'Bearer tenant-secret' }, payload: { messages: [{ role: 'user', content: 'hello' }], policy: { tenantId: 'tenant-b' } } });
    expect(mismatch.statusCode).toBe(403);
    expect(mismatch.json().error.code).toBe('authorization_error');
    await app.close();

    app = await buildApp({ ...base, apiCredentials: [{ id: 'read-only', tenantId: 'tenant-a', keySha256: sha256ApiKey('read-only-secret'), scopes: [] }] });
    const forbidden = await app.inject({ method: 'POST', url: '/v1/responses', headers: { authorization: 'Bearer read-only-secret' }, payload: { messages: [{ role: 'user', content: 'hello' }] } });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().error.code).toBe('authorization_error');
  });

  it('fails closed when production has no authentication configuration', async () => {
    await expect(buildApp({ host: '127.0.0.1', port: 0, logLevel: 'silent', environment: 'production', requestTimeoutMs: 60_000, providerMaxRetries: 0 })).rejects.toThrow('Production requires');
  });

  it('never rate-limits health endpoints', async () => {
    app = await buildApp({ host: '127.0.0.1', port: 0, logLevel: 'silent', environment: 'test', requestTimeoutMs: 60_000, providerMaxRetries: 0, rateLimitMax: 2 });
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await app.inject({ method: 'GET', url: '/healthz' })).statusCode);
    expect(statuses).toEqual([200, 200, 200, 200]);
    const limited = await app.inject({ method: 'POST', url: '/v1/responses', payload: { messages: [{ role: 'user', content: 'x' }] } });
    expect([200, 429]).toContain(limited.statusCode);
  });

  it('treats a zero rate limit as unlimited', async () => {
    app = await buildApp({ host: '127.0.0.1', port: 0, logLevel: 'silent', environment: 'test', requestTimeoutMs: 60_000, providerMaxRetries: 0, rateLimitMax: 0 });
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await app.inject({ method: 'POST', url: '/v1/responses', payload: { messages: [{ role: 'user', content: 'x' }] } })).statusCode);
    expect(statuses).toEqual([200, 200, 200, 200, 200]);
  });

  it('returns a 504 timeout when the request deadline expires over HTTP', async () => {
    const model = { id: 'slow', provider: 'slow', model: 'slow', version: '1', enabled: true, capabilities: [], modalities: ['text' as const], coordinates: { technicality: 0.5, creativity: 0.5, quality: 0.5, reasoning: 0.5 }, pricing: { inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.3 }, contextWindow: 16_000, maxOutputTokens: 4_000, regions: ['global'], allowedDataClasses: ['public' as const, 'internal' as const], health: { availability: 1, latencyP95Ms: 10, errorRate: 0, checkedAt: 'test' } };
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const slow: import('../src/ports/provider.js').ProviderAdapter = {
      name: 'slow', listModels: () => [model],
      complete: async (input) => { await delay(300); if (input.signal.aborted) throw new Error('aborted'); return { output: 'late', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimatedCostUsd: 0 }, finishReason: 'stop' }; },
      stream: async function* () {},
    };
    app = await buildApp({ host: '127.0.0.1', port: 0, logLevel: 'silent', environment: 'test', requestTimeoutMs: 100, providerMaxRetries: 0 }, { providers: [slow], registry: new (await import('../src/registry/memory-registry.js')).InMemoryModelRegistry([model]) });
    const response = await app.inject({ method: 'POST', url: '/v1/responses', payload: { model: 'slow', messages: [{ role: 'user', content: 'hello' }] } });
    expect(response.statusCode).toBe(504);
    expect(response.json().error.code).toBe('timeout');
  });

  it('returns 422 for a streaming request with an unknown model', async () => {
    app = await buildApp({ host: '127.0.0.1', port: 0, logLevel: 'silent', environment: 'test', requestTimeoutMs: 60_000, providerMaxRetries: 0 });
    const response = await app.inject({ method: 'POST', url: '/v1/responses', payload: { stream: true, model: 'missing', messages: [{ role: 'user', content: 'hello' }] } });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('no_eligible_model');
  });

  it('does not leak provider error internals to clients', async () => {
    const failing: import('../src/ports/provider.js').ProviderAdapter = {
      name: 'simulator', listModels: () => [],
      complete: async () => { throw new Error('upstream secret detail'); },
      stream: async function* () {},
    };
    app = await buildApp({ host: '127.0.0.1', port: 0, logLevel: 'silent', environment: 'test', requestTimeoutMs: 60_000, providerMaxRetries: 0 }, { providers: [failing] });
    const response = await app.inject({ method: 'POST', url: '/v1/responses', payload: { messages: [{ role: 'user', content: 'hello' }] } });
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('secret detail');
    expect(response.json().error.message).toBe('An unexpected error occurred');
  });

  it('invalidates cached responses when the registry version changes', async () => {
    const { InMemoryModelRegistry } = await import('../src/registry/memory-registry.js');
    const { DeterministicRouter } = await import('../src/routing/router.js');
    const { RouterService } = await import('../src/service/router-service.js');
    const { defaultModels } = await import('../src/registry/default-models.js');
    const registry = new InMemoryModelRegistry(defaultModels);
    const cache = new InMemoryResponseCache();
    const calls: string[] = [];
    const executor = { execute: async (options: { requestId: string }) => { calls.push(options.requestId); return { requestId: options.requestId, model: 'sim', provider: 'simulator', output: 'out', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimatedCostUsd: 0 }, status: 'completed', finishReason: 'stop', route: {} }; }, stream: async function* () {} } as unknown as import('../src/execution/executor.js').RequestExecutor;
    const service = new RouterService(new DeterministicRouter(registry), executor, cache, 60, () => 1);
    const payload = { messages: [{ role: 'user' as const, content: 'cache version test' }] };
    await service.complete(payload, new AbortController().signal);
    await service.complete(payload, new AbortController().signal);
    expect(calls).toHaveLength(1);
    const updated = new RouterService(new DeterministicRouter(registry), executor, cache, 60, () => 2);
    await updated.complete(payload, new AbortController().signal);
    expect(calls).toHaveLength(2);
  });
});
