import { describe, expect, it } from 'vitest';
import { requestDemandVectorVersion } from '../src/domain/types.js';
import { parseModelCapabilityVector, parseRequestClassification, parseRequestDemandVector, requestDemandVectorSchema } from '../src/routing/vector.js';
import { InMemoryModelRegistry } from '../src/registry/memory-registry.js';
import { defaultModels } from '../src/registry/default-models.js';
import { configuredModelManifests } from '../src/providers/configured.js';

const validVector = {
  version: requestDemandVectorVersion,
  technicalDifficulty: 0.1,
  reasoningDepth: 0.2,
  creativity: 0.3,
  designSkill: 0.4,
  factualPrecision: 0.5,
  qualityRequirement: 0.85,
  ambiguity: 0.6,
  toolComplexity: 0.7,
  contextComplexity: 0.8,
  codingIntensity: 0.9,
  safetyStakes: 0,
};

describe('request demand vectors', () => {
  it('accepts the versioned vector and preserves values without clamping', () => {
    expect(parseRequestDemandVector(validVector)).toEqual(validVector);
  });

  it.each([
    ['below zero', { ...validVector, creativity: -0.01 }],
    ['above one', { ...validVector, creativity: 1.01 }],
    ['infinite', { ...validVector, creativity: Number.POSITIVE_INFINITY }],
    ['not a number', { ...validVector, creativity: Number.NaN }],
  ])('rejects %s values', (_label, value) => {
    expect(() => parseRequestDemandVector(value)).toThrow();
  });

  it('rejects unknown vector keys', () => {
    expect(requestDemandVectorSchema.safeParse({ ...validVector, extra: 0.5 }).success).toBe(false);
    expect(requestDemandVectorSchema.safeParse({ ...validVector, domainSpecialization: 0.5 }).success).toBe(false);
  });
});

describe('request classification contract', () => {
  it('validates the separate deep-reasoning flag and classifier metadata', () => {
    const classification = parseRequestClassification({
      demandVector: validVector,
      deepReasoningRequired: true,
      confidence: 0.92,
      classifierMetadata: { provider: 'deepseek', model: 'v4-flash', classifierVersion: 'v1' },
    });
    expect(classification.deepReasoningRequired).toBe(true);
    expect(classification.confidence).toBe(0.92);
  });
});

describe('model capability vectors', () => {
  it('requires every registered model to have a strict latent-space vector', () => {
    const base = defaultModels[0]!;
    expect(parseModelCapabilityVector(base.capabilityVector)).toEqual(base.capabilityVector);
    const withoutVector = { ...base, capabilityVector: undefined };
    expect(() => new InMemoryModelRegistry([withoutVector as never])).toThrow();
  });

  it('rejects invalid or unknown model axes', () => {
    const capabilityVector = defaultModels[0]!.capabilityVector;
    expect(() => parseModelCapabilityVector({ ...capabilityVector, reasoningDepth: 1.1 })).toThrow();
    expect(() => parseModelCapabilityVector({ ...capabilityVector, unknownAxis: 0.5 })).toThrow();
  });

  it('places configured external models in the validated latent space', () => {
    const [configured] = configuredModelManifests({ OPENAI_API_KEY: 'test', OPENAI_MODEL: 'gpt-test' });
    expect(configured).toBeDefined();
    expect(parseModelCapabilityVector(configured?.capabilityVector)).toMatchObject({ version: 'v1', technicalDifficulty: 0.7, reasoningDepth: 0.75 });
    const [invalid] = configuredModelManifests({ OPENAI_API_KEY: 'test', OPENAI_MODEL: 'gpt-test', OPENAI_CAPABILITY_DESIGN_SKILL: '1.1' });
    expect(() => new InMemoryModelRegistry([invalid!])).toThrow();
  });
});
