import { describe, expect, it } from 'vitest';
import { defaultModels } from '../src/registry/default-models.js';
import { estimateShadowCost, outputDigest, safeShadowRequest, shadowEligible, type ShadowCampaign } from '../src/shadow/shadow.js';

const campaign: ShadowCampaign = {
  id: 'shadow-1', modelId: 'sim-balanced', modelVersion: '1', state: 'active', samplePercentage: 100,
  budgetLimitUsd: 10, reservedUsd: 0, spentUsd: 0, allowedDataClasses: ['public', 'internal'],
  sampleCount: 0, successCount: 0, errorCount: 0, createdAt: '2026-08-10T00:00:00Z', updatedAt: '2026-08-10T00:00:00Z',
};

describe('safe shadow policy', () => {
  it('permits sampled side-effect-free requests and rejects sensitive or tool-bearing work', () => {
    const base = { requestId: 'request-1', messages: [{ role: 'user' as const, content: 'rewrite this' }], policy: { tenantId: 'tenant-a', dataClass: 'internal' as const } };
    expect(shadowEligible(base, campaign)).toBe(true);
    expect(shadowEligible({ ...base, stream: true }, campaign)).toBe(false);
    expect(shadowEligible({ ...base, tools: [{ name: 'send', inputSchema: {} }] }, campaign)).toBe(false);
    expect(shadowEligible({ ...base, messages: [{ role: 'tool', content: 'side effect result' }] }, campaign)).toBe(false);
    expect(shadowEligible({ ...base, policy: { tenantId: 'tenant-a', dataClass: 'confidential' } }, campaign)).toBe(false);
  });

  it('strips tenant, metadata, routing hints, tools, and explicit model from the provider request', () => {
    const safe = safeShadowRequest({ model: 'primary', messages: [{ role: 'user', content: 'hello' }], tools: [], metadata: { customer: 'secret' }, policy: { tenantId: 'tenant-a', dataClass: 'internal', preferProvider: 'x', maxCostUsd: 1 } });
    expect(safe).toEqual({ messages: [{ role: 'user', content: 'hello' }], stream: false, policy: { dataClass: 'internal' } });
  });

  it('estimates a reservation conservatively and hashes outputs without retaining content', () => {
    expect(estimateShadowCost(defaultModels[1]!, { messages: [{ role: 'user', content: 'hello' }], maxOutputTokens: 100 })).toBeGreaterThanOrEqual(0);
    expect(outputDigest('secret output')).toMatch(/^[a-f0-9]{64}$/u);
    expect(outputDigest('secret output')).not.toContain('secret');
  });
});
