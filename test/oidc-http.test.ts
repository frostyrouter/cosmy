import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { buildApp } from '../src/app.js';
import { sha256ApiKey } from '../src/security/auth.js';

const issuer = 'https://identity.example.com';
const audience = 'cosmy-router';
let privateKey: CryptoKey;
let publicJwk: JWK;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: 'workload-key', alg: 'RS256', use: 'sig' };
});

async function workloadToken(overrides: { audience?: string; tenantId?: string; scopes?: string } = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1_000);
  return new SignJWT({ tenant_id: overrides.tenantId ?? 'tenant-a', scope: overrides.scopes ?? 'cosmy:responses:create cosmy:routing:read' })
    .setProtectedHeader({ alg: 'RS256', kid: 'workload-key', typ: 'at+jwt' }).setIssuer(issuer).setAudience(overrides.audience ?? audience)
    .setSubject('service-a').setIssuedAt(now).setExpirationTime(now + 300).sign(privateKey);
}

describe('OIDC HTTP authentication', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  it('composes workload tokens with API keys and never fetches JWKS for known keys on requests', async () => {
    let fetches = 0;
    app = await buildApp({
      environment: 'test', port: 0, logLevel: 'silent', classifierMode: 'disabled', oidcIssuer: issuer, oidcAudience: audience, oidcJwksUri: `${issuer}/jwks`,
      oidcAlgorithms: ['RS256'], oidcTokenType: 'at+jwt', apiCredentials: [{ id: 'admin', tenantId: 'platform', keySha256: sha256ApiKey('admin-secret'), scopes: ['admin:write'] }],
    }, { oidcFetcher: async () => { fetches += 1; return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 }); } });
    const token = await workloadToken();
    const response = await app.inject({ method: 'POST', url: '/v1/responses', headers: { authorization: `Bearer ${token}` }, payload: { messages: [{ role: 'user', content: 'hello from workload' }] } });
    expect(response.statusCode).toBe(200);
    const models = await app.inject({ method: 'GET', url: '/v1/models', headers: { authorization: `Bearer ${token}` } });
    expect(models.statusCode).toBe(200);
    expect(fetches).toBe(1);
    const mismatch = await app.inject({ method: 'POST', url: '/v1/responses', headers: { authorization: `Bearer ${token}` }, payload: { messages: [{ role: 'user', content: 'cross tenant' }], policy: { tenantId: 'tenant-b' } } });
    expect(mismatch.statusCode).toBe(403);
    const workloadAdmin = await app.inject({ method: 'GET', url: '/v1/admin/models', headers: { authorization: `Bearer ${token}` } });
    expect(workloadAdmin.statusCode).toBe(403);
    const staticAdmin = await app.inject({ method: 'GET', url: '/v1/admin/models', headers: { authorization: 'Bearer admin-secret' } });
    expect(staticAdmin.statusCode).toBe(200);
    const wrongAudience = await app.inject({ method: 'POST', url: '/v1/responses', headers: { authorization: `Bearer ${await workloadToken({ audience: 'other' })}` }, payload: { messages: [{ role: 'user', content: 'wrong audience' }] } });
    expect(wrongAudience.statusCode).toBe(401);
  });

  it('fails application startup when configured JWKS cannot be bootstrapped', async () => {
    await expect(buildApp({ environment: 'test', port: 0, logLevel: 'silent', classifierMode: 'disabled', oidcIssuer: issuer, oidcAudience: audience, oidcJwksUri: `${issuer}/jwks` }, { oidcFetcher: async () => new Response('unavailable', { status: 503 }) })).rejects.toThrow('OIDC JWKS bootstrap failed');
  });
});
