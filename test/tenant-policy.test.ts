import { describe, expect, it } from 'vitest';
import { ReloadableTenantPolicyResolver, type TenantPolicyBundle } from '../src/policy/tenant-policy.js';
import { defaultModels } from '../src/registry/default-models.js';

const bundle: TenantPolicyBundle = {
  tenantId: 'tenant-a', version: 7, allowedProviders: ['simulator', 'backup'], deniedProviders: ['backup'],
  allowedModels: [defaultModels[0]!.id, defaultModels[1]!.id], deniedModels: [defaultModels[1]!.id],
  allowedRegions: ['us'], allowedDataClasses: ['public', 'internal'], maxCostUsd: 0.02, maxLatencyMs: 500,
  minQuality: 0.8, allowFallback: false, createdAt: '2026-08-16T00:00:00.000Z', updatedAt: '2026-08-16T00:00:00.000Z',
};

describe('tenant policy resolution', () => {
  it('only tightens request controls and stamps the durable policy version', () => {
    const resolver = new ReloadableTenantPolicyResolver([bundle]);
    const resolved = resolver.resolve({ messages: [{ role: 'user', content: 'hello' }], policy: {
      tenantId: 'tenant-a', allowedProviders: ['simulator', 'other'], allowedModels: [defaultModels[0]!.id, defaultModels[2]!.id],
      deniedProviders: ['other-denied'], maxCostUsd: 0.01, maxLatencyMs: 900, minQuality: 0.7, allowFallback: true,
    } }, 'tenant-a');
    expect(resolved.policy).toMatchObject({
      tenantPolicyVersion: 7, allowedProviders: ['simulator'], deniedProviders: ['backup', 'other-denied'],
      allowedModels: [defaultModels[0]!.id], deniedModels: [defaultModels[1]!.id], allowedRegions: ['us'],
      maxCostUsd: 0.01, maxLatencyMs: 500, minQuality: 0.8, allowFallback: false,
    });
  });

  it('fails closed for disallowed data classes and regions', () => {
    const resolver = new ReloadableTenantPolicyResolver([bundle]);
    expect(() => resolver.resolve({ messages: [{ role: 'user', content: 'secret' }], policy: { dataClass: 'confidential' } }, 'tenant-a')).toThrowError(/not allowed/u);
    expect(() => resolver.resolve({ messages: [{ role: 'user', content: 'regional' }], policy: { region: 'eu' } }, 'tenant-a')).toThrowError(/not allowed/u);
  });

  it('atomically replaces policy snapshots used for model discovery', () => {
    const resolver = new ReloadableTenantPolicyResolver([bundle]);
    expect(defaultModels.filter((model) => resolver.allowsModel('tenant-a', model)).map((model) => model.id)).toEqual([defaultModels[0]!.id]);
    resolver.replace([]);
    expect(defaultModels.every((model) => resolver.allowsModel('tenant-a', model))).toBe(true);
  });
});
