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
});
