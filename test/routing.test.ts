import { describe, expect, it } from 'vitest';
import { defaultModels } from '../src/registry/default-models.js';
import { InMemoryModelRegistry } from '../src/registry/memory-registry.js';
import { DeterministicRouter } from '../src/routing/router.js';
import { capabilityCoverage, filterEligible, paretoPruneCandidates, rankCandidates } from '../src/routing/policy.js';
import { extractFeatures } from '../src/routing/features.js';
import type { ModelConfiguration, RequestFeatures } from '../src/domain/types.js';
import { modelCapabilityVectorVersion, requestDemandVectorVersion } from '../src/domain/types.js';

function vector(overrides: Partial<NonNullable<RequestFeatures['demandVector']>> = {}): NonNullable<RequestFeatures['demandVector']> {
  return {
    version: requestDemandVectorVersion, technicalDifficulty: 0, reasoningDepth: 0, creativity: 0, designSkill: 0,
    factualPrecision: 0, qualityRequirement: 0, ambiguity: 0, toolComplexity: 0, contextComplexity: 0,
    codingIntensity: 0, safetyStakes: 0, ...overrides,
  };
}

function features(demandVector: NonNullable<RequestFeatures['demandVector']>): RequestFeatures {
  return { ...extractFeatures({ messages: [{ role: 'user', content: 'hello' }] }), demandVector };
}

function model(base: ModelConfiguration, overrides: Partial<ModelConfiguration> = {}): ModelConfiguration {
  return { ...base, capabilityVector: { version: modelCapabilityVectorVersion, technicalDifficulty: 1, reasoningDepth: 1, creativity: 1, designSkill: 1, factualPrecision: 1, ambiguity: 1, toolComplexity: 1, contextComplexity: 1, codingIntensity: 1, safetyStakes: 1 }, ...overrides };
}

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

  it('chooses the cheapest candidate that meets predicted quality', () => {
    const demand = features(vector({ qualityRequirement: 0.8, technicalDifficulty: 0.9 }));
    const cheap = model(defaultModels[1]!, { id: 'cheap', coordinates: { ...defaultModels[1]!.coordinates, quality: 0.85 }, pricing: { inputPerMillionUsd: 0.01, outputPerMillionUsd: 0.01 } });
    const expensive = model(defaultModels[2]!, { id: 'expensive', pricing: { inputPerMillionUsd: 10, outputPerMillionUsd: 10 } });
    const eligible = filterEligible([expensive, cheap], demand).eligible;
    expect(rankCandidates(eligible, demand).map((candidate) => candidate.model.id)).toEqual(['cheap', 'expensive']);
  });

  it('rejects a cheap model whose predicted quality is below the demand requirement', () => {
    const demand = features(vector({ qualityRequirement: 0.8 }));
    const cheap = model(defaultModels[0]!, { id: 'cheap', coordinates: { ...defaultModels[0]!.coordinates, quality: 0.7 }, pricing: { inputPerMillionUsd: 0.01, outputPerMillionUsd: 0.01 } });
    const result = filterEligible([cheap], demand);
    expect(result.eligible).toHaveLength(0);
    expect(result.rejected).toEqual([{ modelId: 'cheap', reason: 'quality_floor' }]);
  });

  it('routes design-heavy work away from a cheaper model with weak design skill', () => {
    const demand = features(vector({ designSkill: 1, qualityRequirement: 0.9 }));
    const weakDesign = model(defaultModels[1]!, { id: 'cheap-weak-design', coordinates: { ...defaultModels[1]!.coordinates, quality: 0.95 }, capabilityVector: { ...model(defaultModels[1]!).capabilityVector, designSkill: 0 }, pricing: { inputPerMillionUsd: 0.01, outputPerMillionUsd: 0.01 } });
    const strongDesign = model(defaultModels[2]!, { id: 'expensive-strong-design', coordinates: { ...defaultModels[2]!.coordinates, quality: 0.95 }, pricing: { inputPerMillionUsd: 10, outputPerMillionUsd: 10 } });
    const result = filterEligible([weakDesign, strongDesign], demand);
    expect(result.rejected).toContainEqual({ modelId: 'cheap-weak-design', reason: 'quality_floor' });
    expect(rankCandidates(result.eligible, demand).map((candidate) => candidate.model.id)).toEqual(['expensive-strong-design']);
  });

  it('keeps a reasoning-capable fallback from a cheaper non-reasoning model', () => {
    const demand = features(vector());
    const cheap = model(defaultModels[0]!, { id: 'cheap-non-reasoning', capabilities: ['streaming', 'structured-output'], coordinates: { ...defaultModels[0]!.coordinates, quality: 0.95 }, pricing: { inputPerMillionUsd: 0.01, outputPerMillionUsd: 0.01 }, health: { ...defaultModels[0]!.health, availability: 1, errorRate: 0, latencyP95Ms: 100 } });
    const reasoning = model(defaultModels[1]!, { id: 'reasoning-fallback', coordinates: { ...defaultModels[1]!.coordinates, quality: 0.85 }, pricing: { inputPerMillionUsd: 1, outputPerMillionUsd: 1 }, health: { ...defaultModels[1]!.health, availability: 0.9, errorRate: 0.1, latencyP95Ms: 900 } });
    expect(rankCandidates([cheap, reasoning], demand).map((candidate) => candidate.model.id)).toEqual(['cheap-non-reasoning', 'reasoning-fallback']);
  });

  it('uses lexical model IDs for stable ties regardless of registry order', () => {
    const demand = features(vector());
    const first = model(defaultModels[0]!, { id: 'model-a', pricing: { inputPerMillionUsd: 1, outputPerMillionUsd: 1 } });
    const second = model(defaultModels[0]!, { id: 'model-b', pricing: { inputPerMillionUsd: 1, outputPerMillionUsd: 1 } });
    const ordered = (models: readonly ModelConfiguration[]) => rankCandidates(models, demand).map((candidate) => candidate.model.id);
    expect(ordered([second, first])).toEqual(['model-a', 'model-b']);
    expect(ordered([first, second])).toEqual(['model-a', 'model-b']);
    expect(capabilityCoverage(demand, first)).toBe(1);
    expect(paretoPruneCandidates(rankCandidates([first, second], demand))).toHaveLength(2);
  });
});
