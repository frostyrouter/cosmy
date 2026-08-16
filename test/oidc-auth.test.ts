import { beforeAll, describe, expect, it, vi } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { CachedOidcAuthenticator, type OidcAuthenticatorConfig } from '../src/security/oidc-auth.js';

const issuer = 'https://identity.example.com';
const audience = 'cosmy-router';
const baseConfig: OidcAuthenticatorConfig = {
  issuer, audience, jwksUri: `${issuer}/jwks`, algorithms: ['RS256'], tenantClaim: 'tenant_id', scopeClaim: 'scope', scopePrefix: 'cosmy:',
  maximumTokenAgeSeconds: 3_600, clockToleranceSeconds: 5, maximumJwksStaleSeconds: 86_400, requestTimeoutMs: 1_000, tokenType: 'at+jwt',
};
let firstPrivate: CryptoKey;
let secondPrivate: CryptoKey;
let firstJwk: JWK;
let secondJwk: JWK;

beforeAll(async () => {
  const first = await generateKeyPair('RS256');
  const second = await generateKeyPair('RS256');
  firstPrivate = first.privateKey; secondPrivate = second.privateKey;
  firstJwk = { ...(await exportJWK(first.publicKey)), kid: 'first', alg: 'RS256', use: 'sig', key_ops: ['verify'] };
  secondJwk = { ...(await exportJWK(second.publicKey)), kid: 'second', alg: 'RS256', use: 'sig', key_ops: ['verify'] };
});

async function token(privateKey: CryptoKey, kid: string, claims: Record<string, unknown> = {}, options: { issuer?: string; audience?: string; expiresIn?: number } = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1_000);
  return new SignJWT({ tenant_id: 'tenant-a', scope: 'cosmy:responses:create cosmy:routing:read unrelated', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid, typ: 'at+jwt' }).setIssuer(options.issuer ?? issuer).setAudience(options.audience ?? audience)
    .setSubject('workload-1').setIssuedAt(now).setExpirationTime(now + (options.expiresIn ?? 300)).sign(privateKey);
}

function response(keys: readonly JWK[]): Response { return new Response(JSON.stringify({ keys }), { status: 200, headers: { 'content-type': 'application/json' } }); }

describe('cached OIDC workload identity', () => {
  it('verifies issuer, audience, lifetime, tenant, scopes, and stable privacy-safe identity', async () => {
    const auth = new CachedOidcAuthenticator(baseConfig, async () => response([firstJwk]));
    await auth.refresh();
    const valid = await auth.authenticate(`Bearer ${await token(firstPrivate, 'first')}`);
    expect(valid).toMatchObject({ tenantId: 'tenant-a', scopes: ['responses:create', 'routing:read'] });
    expect(valid?.credentialId).toMatch(/^oidc:[a-f0-9]{32}$/u);
    expect(await auth.authenticate(`Bearer ${await token(firstPrivate, 'first', {}, { audience: 'other' })}`)).toBeUndefined();
    expect(await auth.authenticate(`Bearer ${await token(firstPrivate, 'first', { tenant_id: 'invalid tenant' })}`)).toBeUndefined();
    expect(await auth.authenticate('Bearer not-a-jwt')).toBeUndefined();
  });

  it('rejects the wrong issuer or token type and tokens missing required timestamps', async () => {
    const auth = new CachedOidcAuthenticator(baseConfig, async () => response([firstJwk]));
    await auth.refresh();
    expect(await auth.authenticate(`Bearer ${await token(firstPrivate, 'first', {}, { issuer: 'https://other.example.com' })}`)).toBeUndefined();
    const now = Math.floor(Date.now() / 1_000);
    const wrongType = await new SignJWT({ tenant_id: 'tenant-a', scope: 'cosmy:responses:create' })
      .setProtectedHeader({ alg: 'RS256', kid: 'first', typ: 'JWT' }).setIssuer(issuer).setAudience(audience)
      .setSubject('workload-1').setIssuedAt(now).setExpirationTime(now + 300).sign(firstPrivate);
    expect(await auth.authenticate(`Bearer ${wrongType}`)).toBeUndefined();
    const missingExpiry = await new SignJWT({ tenant_id: 'tenant-a', scope: 'cosmy:responses:create' })
      .setProtectedHeader({ alg: 'RS256', kid: 'first', typ: 'at+jwt' }).setIssuer(issuer).setAudience(audience)
      .setSubject('workload-1').setIssuedAt(now).sign(firstPrivate);
    expect(await auth.authenticate(`Bearer ${missingExpiry}`)).toBeUndefined();
    const missingIssuedAt = await new SignJWT({ tenant_id: 'tenant-a', scope: 'cosmy:responses:create' })
      .setProtectedHeader({ alg: 'RS256', kid: 'first', typ: 'at+jwt' }).setIssuer(issuer).setAudience(audience)
      .setSubject('workload-1').setExpirationTime(now + 300).sign(firstPrivate);
    expect(await auth.authenticate(`Bearer ${missingIssuedAt}`)).toBeUndefined();
    const missingKeyId = await new SignJWT({ tenant_id: 'tenant-a', scope: 'cosmy:responses:create' })
      .setProtectedHeader({ alg: 'RS256', typ: 'at+jwt' }).setIssuer(issuer).setAudience(audience)
      .setSubject('workload-1').setIssuedAt(now).setExpirationTime(now + 300).sign(firstPrivate);
    expect(await auth.authenticate(`Bearer ${missingKeyId}`)).toBeUndefined();
  });

  it('fails an unknown kid immediately and refreshes keys in the background', async () => {
    let keys: readonly JWK[] = [firstJwk];
    let fetches = 0;
    const auth = new CachedOidcAuthenticator(baseConfig, async () => { fetches += 1; return response(keys); });
    await auth.refresh();
    keys = [secondJwk];
    const rotated = await token(secondPrivate, 'second');
    expect(await auth.authenticate(`Bearer ${rotated}`)).toBeUndefined();
    await auth.refresh();
    expect(fetches).toBe(2);
    expect(await auth.authenticate(`Bearer ${rotated}`)).toMatchObject({ tenantId: 'tenant-a' });
    expect(await auth.authenticate(`Bearer ${await token(firstPrivate, 'first')}`)).toBeUndefined();
  });

  it('preserves known-good keys across refresh failure but fails closed after maximum staleness', async () => {
    vi.useFakeTimers();
    const now = Date.now(); vi.setSystemTime(now);
    let fail = false;
    const auth = new CachedOidcAuthenticator({ ...baseConfig, maximumJwksStaleSeconds: 1 }, async () => {
      if (fail) throw new Error('identity provider unavailable');
      return response([firstJwk]);
    });
    await auth.refresh();
    const valid = await token(firstPrivate, 'first', {}, { expiresIn: 300 });
    fail = true;
    await expect(auth.refresh()).rejects.toThrow('unavailable');
    expect(await auth.authenticate(`Bearer ${valid}`)).toMatchObject({ tenantId: 'tenant-a' });
    vi.setSystemTime(now + 2_000);
    expect(await auth.authenticate(`Bearer ${valid}`)).toBeUndefined();
    vi.useRealTimers();
  });

  it('rejects private, duplicate, and algorithm-incompatible JWKS material', async () => {
    await expect(new CachedOidcAuthenticator(baseConfig, async () => response([{ ...firstJwk, d: 'private' }])).refresh()).rejects.toThrow(/private or disallowed/u);
    await expect(new CachedOidcAuthenticator(baseConfig, async () => response([firstJwk, firstJwk])).refresh()).rejects.toThrow(/unique kid/u);
    await expect(new CachedOidcAuthenticator(baseConfig, async () => response([{ ...firstJwk, alg: 'RS512' }])).refresh()).rejects.toThrow(/private or disallowed/u);
  });

  it('rejects insecure or credential-bearing identity endpoints before fetching', () => {
    expect(() => new CachedOidcAuthenticator({ ...baseConfig, issuer: 'http://identity.example.com' })).toThrow(/issuer/u);
    expect(() => new CachedOidcAuthenticator({ ...baseConfig, jwksUri: 'https://user:password@identity.example.com/jwks' })).toThrow(/JWKS URI/u);
  });
});
