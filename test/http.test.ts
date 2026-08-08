import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { InMemoryResponseCache } from '../src/persistence/memory-cache.js';

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

  it('never rate-limits health endpoints', async () => {
    app = await buildApp({ host: '127.0.0.1', port: 0, logLevel: 'silent', environment: 'test', requestTimeoutMs: 60_000, providerMaxRetries: 0, rateLimitMax: 2 });
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await app.inject({ method: 'GET', url: '/healthz' })).statusCode);
    expect(statuses).toEqual([200, 200, 200, 200]);
    const limited = await app.inject({ method: 'POST', url: '/v1/responses', payload: { messages: [{ role: 'user', content: 'x' }] } });
    expect([200, 429]).toContain(limited.statusCode);
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
    const service = new RouterService(new DeterministicRouter(registry), executor, cache, 60, 1);
    const payload = { messages: [{ role: 'user' as const, content: 'cache version test' }] };
    await service.complete(payload, new AbortController().signal);
    await service.complete(payload, new AbortController().signal);
    expect(calls).toHaveLength(1);
    const updated = new RouterService(new DeterministicRouter(registry), executor, cache, 60, 2);
    await updated.complete(payload, new AbortController().signal);
    expect(calls).toHaveLength(2);
  });
});
