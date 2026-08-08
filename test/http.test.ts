import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

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

  it('rejects unknown request fields and invalid messages', async () => {
    app = await buildApp({ host: '127.0.0.1', port: 0, logLevel: 'silent', environment: 'test', requestTimeoutMs: 60_000, providerMaxRetries: 0 });
    const response = await app.inject({ method: 'POST', url: '/v1/responses', payload: { messages: [], unexpected: true } });
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
});
