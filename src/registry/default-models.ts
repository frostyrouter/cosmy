import type { ModelConfiguration } from '../domain/types.js';

const health = { availability: 0.999, latencyP95Ms: 600, errorRate: 0.001, checkedAt: 'static' };

export const defaultModels: readonly ModelConfiguration[] = [
  {
    id: 'sim-small-text', provider: 'simulator', model: 'sim-small', version: '1', enabled: true,
    capabilities: ['streaming', 'structured-output'], modalities: ['text'],
    coordinates: { technicality: 0.25, creativity: 0.55, quality: 0.65, reasoning: 0.3 },
    pricing: { inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.3 }, contextWindow: 16_000,
    maxOutputTokens: 4_000, regions: ['global'], allowedDataClasses: ['public', 'internal'], health,
    capabilityVector: { version: 'v1', technicalDifficulty: 0.25, reasoningDepth: 0.3, creativity: 0.55, designSkill: 0.4, factualPrecision: 0.65, ambiguity: 0.35, toolComplexity: 0, contextComplexity: 0.2, codingIntensity: 0.2, safetyStakes: 0.5 },
  },
  {
    id: 'sim-balanced', provider: 'simulator', model: 'sim-balanced', version: '1', enabled: true,
    capabilities: ['streaming', 'tools', 'structured-output', 'reasoning'], modalities: ['text'],
    coordinates: { technicality: 0.6, creativity: 0.6, quality: 0.85, reasoning: 0.7 },
    pricing: { inputPerMillionUsd: 0.8, outputPerMillionUsd: 2.4 }, contextWindow: 64_000,
    maxOutputTokens: 8_000, regions: ['global'], allowedDataClasses: ['public', 'internal', 'confidential'], health,
    capabilityVector: { version: 'v1', technicalDifficulty: 0.6, reasoningDepth: 0.7, creativity: 0.6, designSkill: 0.65, factualPrecision: 0.85, ambiguity: 0.7, toolComplexity: 0.75, contextComplexity: 0.55, codingIntensity: 0.6, safetyStakes: 0.8 },
  },
  {
    id: 'sim-frontier', provider: 'simulator', model: 'sim-frontier', version: '1', enabled: true,
    capabilities: ['streaming', 'tools', 'structured-output', 'vision', 'reasoning'], modalities: ['text', 'image', 'file'],
    coordinates: { technicality: 0.95, creativity: 0.8, quality: 0.98, reasoning: 0.98 },
    pricing: { inputPerMillionUsd: 5, outputPerMillionUsd: 15 }, contextWindow: 200_000,
    maxOutputTokens: 16_000, regions: ['global', 'us', 'eu'], allowedDataClasses: ['public', 'internal', 'confidential', 'restricted'], health,
    capabilityVector: { version: 'v1', technicalDifficulty: 0.95, reasoningDepth: 0.98, creativity: 0.8, designSkill: 0.9, factualPrecision: 0.98, ambiguity: 0.95, toolComplexity: 0.95, contextComplexity: 0.95, codingIntensity: 0.95, safetyStakes: 0.98 },
  },
];
