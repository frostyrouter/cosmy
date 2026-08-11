import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { sha256ApiKey, StaticApiKeyAuthenticator } from '../src/security/auth.js';

describe('tenant authentication', () => {
  it('stores and compares only API-key digests', () => {
    const authenticator = new StaticApiKeyAuthenticator([{ id: 'project-a', tenantId: 'tenant-a', keySha256: sha256ApiKey('secret'), scopes: ['responses:create'] }]);
    expect(authenticator.authenticate('Bearer secret')).toEqual({ credentialId: 'project-a', tenantId: 'tenant-a', scopes: ['responses:create'] });
    expect(authenticator.authenticate('Bearer wrong')).toBeUndefined();
    expect(authenticator.authenticate(undefined)).toBeUndefined();
  });

  it('rejects duplicate enabled digests instead of changing tenant identity by order', () => {
    const digest = sha256ApiKey('shared-secret');
    expect(() => new StaticApiKeyAuthenticator([
      { id: 'project-a', tenantId: 'tenant-a', keySha256: digest, scopes: ['responses:create'] },
      { id: 'project-b', tenantId: 'tenant-b', keySha256: digest, scopes: ['responses:create'] },
    ])).toThrow('duplicate SHA-256 digest');
  });

  it('parses scoped credential metadata from JSON without plaintext keys', () => {
    const digest = sha256ApiKey('secret');
    const config = loadConfig({ ROUTER_ENV: 'production', COSMY_API_CREDENTIALS: JSON.stringify([{ id: 'project-a', tenantId: 'tenant-a', keySha256: digest, scopes: ['responses:create'] }]) });
    expect(config.apiCredentials).toEqual([{ id: 'project-a', tenantId: 'tenant-a', keySha256: digest, scopes: ['responses:create'] }]);
    expect(config.allowUnauthenticated).toBe(false);
  });

  it('parses administrative scopes explicitly', () => {
    const digest = sha256ApiKey('admin');
    expect(loadConfig({ COSMY_API_CREDENTIALS: JSON.stringify([{ id: 'admin', tenantId: 'platform', keySha256: digest, scopes: ['admin:read', 'admin:write'] }]) }).apiCredentials?.[0]?.scopes).toEqual(['admin:read', 'admin:write']);
  });

  it('parses the dedicated metrics scope', () => {
    const digest = sha256ApiKey('scraper');
    expect(loadConfig({ COSMY_API_CREDENTIALS: JSON.stringify([{ id: 'metrics', tenantId: 'operations', keySha256: digest, scopes: ['metrics:read'] }]) }).apiCredentials?.[0]?.scopes).toEqual(['metrics:read']);
  });

  it('parses the tenant-scoped routing read permission', () => {
    const digest = sha256ApiKey('routing-reader');
    expect(loadConfig({ COSMY_API_CREDENTIALS: JSON.stringify([{ id: 'routing', tenantId: 'tenant-a', keySha256: digest, scopes: ['routing:read'] }]) }).apiCredentials?.[0]?.scopes).toEqual(['routing:read']);
  });

  it('rejects malformed credential configuration', () => {
    expect(() => loadConfig({ COSMY_API_CREDENTIALS: 'not-json' })).toThrow('valid JSON');
    expect(() => new StaticApiKeyAuthenticator([{ id: 'bad', tenantId: 'tenant', keySha256: 'plaintext', scopes: ['responses:create'] }])).toThrow('invalid SHA-256');
  });

  it('treats a zero tenant budget as unlimited and rejects invalid negatives', () => {
    expect(loadConfig({ TENANT_BUDGET_USD: '0' }).tenantBudgetUsd).toBeUndefined();
    expect(() => loadConfig({ TENANT_BUDGET_USD: '-1' })).toThrow('non-negative');
  });

  it('requires a positive whole-second idempotency retention period', () => {
    expect(loadConfig({ IDEMPOTENCY_TTL_SECONDS: '3600' }).idempotencyTtlSeconds).toBe(3600);
    expect(() => loadConfig({ IDEMPOTENCY_TTL_SECONDS: '0' })).toThrow('positive integer');
    expect(() => loadConfig({ IDEMPOTENCY_TTL_SECONDS: '1.5' })).toThrow('positive integer');
  });

  it('validates reservation recovery timing', () => {
    expect(loadConfig({ RESERVATION_LEASE_SECONDS: '600', RECONCILIATION_SWEEP_SECONDS: '0' })).toMatchObject({ reservationLeaseSeconds: 600, reconciliationSweepSeconds: 0 });
    expect(() => loadConfig({ RESERVATION_LEASE_SECONDS: '-1' })).toThrow('positive integer');
    expect(() => loadConfig({ RECONCILIATION_SWEEP_SECONDS: '1.5' })).toThrow('non-negative integer');
  });
});
