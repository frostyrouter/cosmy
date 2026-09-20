import { createHash } from 'node:crypto';
import { createLocalJWKSet, errors, jwtVerify, type JSONWebKeySet } from 'jose';
import type { ApiScope, RequestAuthenticator, RequestPrincipal } from './auth.js';

export interface OidcAuthenticatorConfig {
  issuer: string;
  audience: string;
  jwksUri: string;
  algorithms: readonly string[];
  tenantClaim: string;
  scopeClaim: string;
  scopePrefix: string;
  maximumTokenAgeSeconds: number;
  clockToleranceSeconds: number;
  maximumJwksStaleSeconds: number;
  requestTimeoutMs: number;
  tokenType?: string;
}

export type OidcFetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;
const apiScopes = new Set<ApiScope>(['responses:create', 'routing:read', 'admin:read', 'admin:write', 'metrics:read']);
const supportedAlgorithms = new Set(['RS256', 'PS256', 'ES256', 'EdDSA']);

export class CachedOidcAuthenticator implements RequestAuthenticator {
  private verifier?: ReturnType<typeof createLocalJWKSet>;
  private lastSuccessfulRefreshMs = 0;
  private refreshInFlight: Promise<void> | undefined;

  constructor(private readonly config: OidcAuthenticatorConfig, private readonly fetcher: OidcFetcher = fetch, private readonly onRefreshFailure: (error: unknown) => void = () => undefined) {
    validateConfig(config);
  }

  get ready(): boolean { return Boolean(this.verifier) && Date.now() - this.lastSuccessfulRefreshMs <= this.config.maximumJwksStaleSeconds * 1_000; }

  refresh(): Promise<void> {
    if (this.refreshInFlight) return this.refreshInFlight;
    const operation = this.fetchJwks().finally(() => { if (this.refreshInFlight === operation) this.refreshInFlight = undefined; });
    this.refreshInFlight = operation;
    return operation;
  }

  async authenticate(authorization: string | undefined): Promise<RequestPrincipal | undefined> {
    const token = bearerToken(authorization);
    if (!token || token.length > 16_384 || token.split('.').length !== 3 || !this.ready || !this.verifier) return undefined;
    try {
      const { payload, protectedHeader } = await jwtVerify(token, this.verifier, {
        issuer: this.config.issuer,
        audience: this.config.audience,
        algorithms: [...this.config.algorithms],
        requiredClaims: ['iss', 'aud', 'sub', 'exp', 'iat', this.config.tenantClaim],
        maxTokenAge: this.config.maximumTokenAgeSeconds,
        clockTolerance: this.config.clockToleranceSeconds,
        ...(this.config.tokenType ? { typ: this.config.tokenType } : {}),
      });
      if (typeof protectedHeader.kid !== 'string' || !protectedHeader.kid) return undefined;
      if (typeof payload.sub !== 'string' || payload.sub.length < 1 || payload.sub.length > 1_024) return undefined;
      const tenantId = payload[this.config.tenantClaim];
      if (typeof tenantId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/u.test(tenantId)) return undefined;
      const scopes = mappedScopes(payload[this.config.scopeClaim], this.config.scopePrefix);
      return { credentialId: `oidc:${createHash('sha256').update(`${this.config.issuer}\0${payload.sub}`).digest('hex').slice(0, 32)}`, tenantId, scopes };
    } catch (error) {
      if (error instanceof errors.JWKSNoMatchingKey) void this.refresh().catch(this.onRefreshFailure);
      return undefined;
    }
  }

  private async fetchJwks(): Promise<void> {
    const response = await this.fetcher(this.config.jwksUri, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(this.config.requestTimeoutMs), headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`OIDC JWKS returned HTTP ${response.status}`);
    const text = await response.text();
    if (text.length > 1_048_576) throw new Error('OIDC JWKS exceeds one MiB');
    const parsed = JSON.parse(text) as Partial<JSONWebKeySet>;
    if (!parsed || !Array.isArray(parsed.keys) || parsed.keys.length < 1 || parsed.keys.length > 100) throw new Error('OIDC JWKS must contain 1-100 keys');
    const kids = new Set<string>();
    for (const key of parsed.keys) {
      if (!key || typeof key !== 'object' || !['RSA', 'EC', 'OKP'].includes(key.kty ?? '') || typeof key.kid !== 'string' || !key.kid || kids.has(key.kid)) throw new Error('OIDC JWKS keys require a unique kid and supported asymmetric kty');
      if ('d' in key || key.use && key.use !== 'sig' || key.key_ops && !key.key_ops.includes('verify') || key.alg && !this.config.algorithms.includes(key.alg)) throw new Error('OIDC JWKS contains a private or disallowed signing key');
      kids.add(key.kid);
    }
    const jwks = { keys: parsed.keys } as JSONWebKeySet;
    this.verifier = createLocalJWKSet(jwks);
    this.lastSuccessfulRefreshMs = Date.now();
  }
}

function bearerToken(authorization: string | undefined): string | undefined {
  if (!authorization?.startsWith('Bearer ')) return undefined;
  const token = authorization.slice(7);
  return token || undefined;
}

function mappedScopes(value: unknown, prefix: string): ApiScope[] {
  const claims = typeof value === 'string' ? value.split(/\s+/u).filter(Boolean) : Array.isArray(value) && value.every((entry) => typeof entry === 'string') ? value : [];
  return [...new Set(claims.flatMap((claim) => claim.startsWith(prefix) && apiScopes.has(claim.slice(prefix.length) as ApiScope) ? [claim.slice(prefix.length) as ApiScope] : []))].sort();
}

function validateConfig(config: OidcAuthenticatorConfig): void {
  const issuer = new URL(config.issuer);
  const jwks = new URL(config.jwksUri);
  if (issuer.protocol !== 'https:' || issuer.username || issuer.password || issuer.search || issuer.hash) throw new Error('OIDC issuer must be an HTTPS URL without credentials, query, or fragment');
  if (jwks.protocol !== 'https:' || jwks.username || jwks.password) throw new Error('OIDC JWKS URI must be an HTTPS URL without credentials');
  if (!config.audience || config.audience.length > 512) throw new Error('OIDC audience is required and limited to 512 characters');
  if (!config.algorithms.length || config.algorithms.some((algorithm) => !supportedAlgorithms.has(algorithm))) throw new Error('OIDC algorithms must be a non-empty allowlist of RS256, PS256, ES256, or EdDSA');
  if (!/^[A-Za-z0-9._:-]{1,128}$/u.test(config.tenantClaim) || !/^[A-Za-z0-9._:-]{1,128}$/u.test(config.scopeClaim)) throw new Error('OIDC claim names are invalid');
  if (config.scopePrefix.length > 128) throw new Error('OIDC scope prefix is too long');
  for (const [name, value] of Object.entries({ maximumTokenAgeSeconds: config.maximumTokenAgeSeconds, maximumJwksStaleSeconds: config.maximumJwksStaleSeconds, requestTimeoutMs: config.requestTimeoutMs })) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`OIDC ${name} must be positive`);
  }
  if (!Number.isFinite(config.clockToleranceSeconds) || config.clockToleranceSeconds < 0) throw new Error('OIDC clockToleranceSeconds must be non-negative');
}
