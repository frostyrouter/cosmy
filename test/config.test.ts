import { describe, expect, it } from 'vitest';
import { loadConfig, resolveConfig } from '../src/config.js';

describe('classifier configuration', () => {
  it('keeps local routing deterministic when no DeepSeek key is configured', () => {
    expect(loadConfig({ ROUTER_ENV: 'development' }).classifierMode).toBe('disabled');
  });

  it('defaults to degradation in development and fail-closed in production', () => {
    expect(loadConfig({ ROUTER_ENV: 'development', DEEPSEEK_API_KEY: 'test' }).classifierMode).toBe('degrade');
    expect(loadConfig({ ROUTER_ENV: 'production', DEEPSEEK_API_KEY: 'test' }).classifierMode).toBe('fail');
    expect(loadConfig({ ROUTER_ENV: 'production' }).classifierMode).toBe('fail');
  });

  it('honors an explicit valid mode and rejects unknown modes', () => {
    expect(loadConfig({ ROUTER_ENV: 'production', CLASSIFIER_MODE: 'disabled' }).classifierMode).toBe('disabled');
    expect(() => loadConfig({ CLASSIFIER_MODE: 'sometimes' })).toThrow('Unsupported CLASSIFIER_MODE');
  });
});

describe('programmatic configuration', () => {
  it('applies safe defaults to partial app configuration without inheriting ambient test credentials', () => {
    const resolved = resolveConfig({ environment: 'test', port: 0 }, { OPENAI_API_KEY: 'must-not-affect-config-defaults' });
    expect(resolved).toMatchObject({ environment: 'test', port: 0, requestTimeoutMs: 60_000, providerMaxRetries: 2, persistenceMode: 'memory', cacheMode: 'off' });
    expect(resolved.apiCredentials).toBeUndefined();
  });

  it('rejects unsafe programmatic timeout and retry values', () => {
    expect(() => resolveConfig({ requestTimeoutMs: 0 }, {})).toThrow('positive request timeout');
    expect(() => resolveConfig({ providerMaxRetries: -1 }, {})).toThrow('non-negative provider retries');
    expect(() => resolveConfig({ classifierTimeoutMs: 0 }, {})).toThrow('positive classifier timeout');
    expect(() => resolveConfig({ registryRefreshSeconds: -1 }, {})).toThrow('non-negative registry refresh interval');
  });
});
