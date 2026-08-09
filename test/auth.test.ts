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

  it('parses scoped credential metadata from JSON without plaintext keys', () => {
    const digest = sha256ApiKey('secret');
    const config = loadConfig({ ROUTER_ENV: 'production', COSMY_API_CREDENTIALS: JSON.stringify([{ id: 'project-a', tenantId: 'tenant-a', keySha256: digest, scopes: ['responses:create'] }]) });
    expect(config.apiCredentials).toEqual([{ id: 'project-a', tenantId: 'tenant-a', keySha256: digest, scopes: ['responses:create'] }]);
    expect(config.allowUnauthenticated).toBe(false);
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
