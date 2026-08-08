import { describe, expect, it } from 'vitest';
import { defaultModels } from '../src/registry/default-models.js';
import { InMemoryModelRegistry } from '../src/registry/memory-registry.js';
import { DeterministicRouter } from '../src/routing/router.js';
import { filterEligible, rankCandidates } from '../src/routing/policy.js';
import { extractFeatures } from '../src/routing/features.js';

describe('request feature extraction', () => {
  it('recognizes technical, creative, tool, and structured requirements', () => {
    const features = extractFeatures({
      messages: [{ role: 'user', content: 'Design a TypeScript API architecture and brainstorm a playful name' }],
      tools: [{ name: 'lookup', inputSchema: {} }], responseFormat: { type: 'json-schema', schema: {} }, stream: true,
    });
    expect(features.technicality).toBeGreaterThan(0);
    expect(features.creativity).toBeGreaterThan(0);
    expect(features.hasTools).toBe(true);
    expect(features.needsStructuredOutput).toBe(true);
    expect(features.needsStreaming).toBe(true);
  });
});

describe('eligibility and ranking', () => {
  it('filters unsupported capabilities before scoring', () => {
    const features = extractFeatures({ messages: [{ role: 'user', content: 'hello' }], tools: [{ name: 'x', inputSchema: {} }] });
    const result = filterEligible(defaultModels, features);
    expect(result.eligible.map((model) => model.id)).toEqual(['sim-balanced', 'sim-frontier']);
    expect(result.rejected.find((item) => item.modelId === 'sim-small-text')?.reason).toBe('tools_unsupported');
  });

  it('uses a cost ceiling as a ranking signal without violating eligibility', () => {
    const features = extractFeatures({ messages: [{ role: 'user', content: 'Rewrite this email' }], maxOutputTokens: 100 });
    const ranked = rankCandidates(defaultModels, features, { maxCostUsd: 0.01 });
    expect(ranked[0]?.model.id).toBe('sim-small-text');
    expect(ranked.every((candidate) => candidate.score <= 1.5)).toBe(true);
  });

  it('honors explicit model requests and rejects unknown IDs', () => {
    const router = new DeterministicRouter(new InMemoryModelRegistry(defaultModels));
    const decision = router.decide('req_test', { model: 'sim-frontier', messages: [{ role: 'user', content: 'hello' }] });
    expect(decision.selected.model.id).toBe('sim-frontier');
    expect(() => router.decide('req_test', { model: 'missing', messages: [{ role: 'user', content: 'hello' }] })).toThrow(/not registered/u);
  });

  it('rejects candidates that exceed the maximum cost or latency', () => {
    const features = extractFeatures({ messages: [{ role: 'user', content: 'hello' }] });
    const byCost = filterEligible(defaultModels, features, { maxCostUsd: 0.001 });
    expect(byCost.eligible.map((model) => model.id)).toEqual(['sim-small-text']);
    expect(byCost.rejected.find((item) => item.reason === 'max_cost_exceeded')?.modelId).toBe('sim-balanced');
    const byLatency = filterEligible(defaultModels, features, { maxLatencyMs: 500 });
    expect(byLatency.eligible).toHaveLength(0);
    expect(byLatency.rejected.every((item) => item.reason === 'max_latency_exceeded')).toBe(true);
  });

  it('enforces required capabilities as hard constraints', () => {
    const features = extractFeatures({ messages: [{ role: 'user', content: 'hello' }] });
    const result = filterEligible(defaultModels, features, { requireCapabilities: ['vision'] });
    expect(result.eligible.map((model) => model.id)).toEqual(['sim-frontier']);
    expect(result.rejected.find((item) => item.reason === 'required_capability_missing')?.modelId).toBe('sim-small-text');
  });

  it('does not route to a model over the caller cost cap when it would otherwise win', () => {
    const router = new DeterministicRouter(new InMemoryModelRegistry(defaultModels));
    const decision = router.decide('req_cost', { messages: [{ role: 'user', content: 'Rewrite this email professionally with high quality' }], maxOutputTokens: 4000, policy: { maxCostUsd: 0.0015 } });
    expect(decision.selected.estimatedCostUsd).toBeLessThanOrEqual(0.0015);
    expect(decision.selected.model.id).toBe('sim-small-text');
    expect(decision.rejected.find((item) => item.reason === 'max_cost_exceeded')?.modelId).toBe('sim-balanced');
  });
});
