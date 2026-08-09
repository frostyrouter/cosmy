import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { sha256ApiKey } from '../src/security/auth.js';

const metricsKey = 'metrics-secret';
const responseKey = 'response-secret';
const config = {
  host: '127.0.0.1', port: 0, logLevel: 'silent', environment: 'test' as const, requestTimeoutMs: 60_000, providerMaxRetries: 0, rateLimitMax: 1,
  apiCredentials: [
    { id: 'scraper', tenantId: 'operations', keySha256: sha256ApiKey(metricsKey), scopes: ['metrics:read' as const] },
    { id: 'caller', tenantId: 'tenant-secret', keySha256: sha256ApiKey(responseKey), scopes: ['responses:create' as const] },
  ],
};

describe('Prometheus metrics endpoint', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  it('requires a metrics scope and exports bounded non-sensitive labels', async () => {
    app = await buildApp(config);
    await app.inject({ method: 'POST', url: '/v1/responses', headers: { authorization: `Bearer ${responseKey}` }, payload: { messages: [{ role: 'user', content: 'private prompt value' }] } });
    const missing = await app.inject({ method: 'GET', url: '/metrics' });
    const ordinary = await app.inject({ method: 'GET', url: '/metrics', headers: { authorization: `Bearer ${responseKey}` } });
    const allowed = await app.inject({ method: 'GET', url: '/metrics', headers: { authorization: `Bearer ${metricsKey}` } });
    expect(missing.statusCode).toBe(401);
    expect(ordinary.statusCode).toBe(403);
    expect(allowed.statusCode).toBe(200);
    expect(allowed.headers['content-type']).toContain('text/plain');
    expect(allowed.body).toContain('cosmy_provider_attempts_total{provider="simulator"');
    expect(allowed.body).not.toContain('private prompt value');
    expect(allowed.body).not.toContain('tenant-secret');
    expect(allowed.body).not.toContain(metricsKey);
    expect((await app.inject({ method: 'GET', url: '/metrics', headers: { authorization: `Bearer ${metricsKey}` } })).statusCode).toBe(200);
  });
});
