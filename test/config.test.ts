import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

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
