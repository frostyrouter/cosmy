import { describe, expect, it } from 'vitest';
import { defaultModels } from '../src/registry/default-models.js';
import { estimateShadowCost, outputDigest, safeShadowRequest, shadowEligible, type ShadowCampaign } from '../src/shadow/shadow.js';
import { ShadowCoordinator } from '../src/shadow/coordinator.js';
import { InMemoryModelRegistry } from '../src/registry/memory-registry.js';
import type { ControlPlaneStore } from '../src/persistence/contracts.js';
import type { ShadowObservation } from '../src/shadow/shadow.js';

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

  it('executes asynchronously with separate reservation accounting and hash-only observations', async () => {
    const observations: ShadowObservation[] = []; const reconciled: number[] = [];
    const store = { reserveShadow: async (campaignId: string, estimatedCostUsd: number) => ({ id: 'reservation-1', campaignId, estimatedCostUsd }), reconcileShadow: async (_reservation: unknown, cost: number) => { reconciled.push(cost); }, recordShadowObservation: async (observation: ShadowObservation) => { observations.push(observation); } } as unknown as ControlPlaneStore;
    const model = defaultModels[1]!;
    const provider = { name: model.provider, listModels: () => [model], complete: async () => ({ output: 'shadow output', usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5, estimatedCostUsd: 0.01 }, finishReason: 'stop' as const }), stream: async function* () {} };
    const coordinator = new ShadowCoordinator(store, new InMemoryModelRegistry(defaultModels), [provider]); coordinator.load([campaign]);
    const request = { requestId: 'request-1', messages: [{ role: 'user' as const, content: 'hello' }], policy: { tenantId: 'tenant-a', dataClass: 'internal' as const } };
    const primary = { requestId: 'request-1', model: 'sim-small', provider: 'simulator', output: 'primary output', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimatedCostUsd: 0 }, status: 'completed' as const, finishReason: 'stop' as const, route: { requestId: 'request-1', selected: { model: defaultModels[0]!, score: 1, capabilityCoverage: 1, predictedTaskQuality: 1, estimatedCostUsd: 0, estimatedLatencyMs: 1, reasons: [] }, alternatives: [], rejected: [], features: { inputTokens: 1, requestedOutputTokens: 1, messageCount: 1, modalities: ['text' as const], hasTools: false, needsStructuredOutput: false, needsStreaming: false, technicality: 0, creativity: 0, reasoning: 0, dataClass: 'internal' as const }, policyVersion: 'v1', createdAt: new Date().toISOString() } };
    coordinator.enqueue(request, primary);
    expect(observations).toHaveLength(0);
    const deadline = Date.now() + 1_000; while (!observations.length && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(reconciled).toEqual([0.01]);
    expect(observations[0]).toMatchObject({ status: 'success', exactMatch: false });
    expect(observations[0]?.primaryOutputSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(observations[0]?.primaryOutputSha256).not.toBe(outputDigest('primary output'));
    expect(JSON.stringify(observations[0])).not.toContain('primary output');
  });
});
