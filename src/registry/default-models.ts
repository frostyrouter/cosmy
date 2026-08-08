import type { ModelConfiguration } from '../domain/types.js';

const health = { availability: 0.999, latencyP95Ms: 600, errorRate: 0.001, checkedAt: 'static' };

export const defaultModels: readonly ModelConfiguration[] = [
  {
    id: 'sim-small-text', provider: 'simulator', model: 'sim-small', version: '1', enabled: true,
    capabilities: ['streaming', 'structured-output'], modalities: ['text'],
    coordinates: { technicality: 0.25, creativity: 0.55, quality: 0.65, reasoning: 0.3 },
    pricing: { inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.3 }, contextWindow: 16_000,
    maxOutputTokens: 4_000, regions: ['global'], allowedDataClasses: ['public', 'internal'], health,
  },
  {
    id: 'sim-balanced', provider: 'simulator', model: 'sim-balanced', version: '1', enabled: true,
    capabilities: ['streaming', 'tools', 'structured-output', 'reasoning'], modalities: ['text'],
    coordinates: { technicality: 0.6, creativity: 0.6, quality: 0.85, reasoning: 0.7 },
    pricing: { inputPerMillionUsd: 0.8, outputPerMillionUsd: 2.4 }, contextWindow: 64_000,
    maxOutputTokens: 8_000, regions: ['global'], allowedDataClasses: ['public', 'internal', 'confidential'], health,
  },
  {
    id: 'sim-frontier', provider: 'simulator', model: 'sim-frontier', version: '1', enabled: true,
    capabilities: ['streaming', 'tools', 'structured-output', 'vision', 'reasoning'], modalities: ['text', 'image', 'file'],
    coordinates: { technicality: 0.95, creativity: 0.8, quality: 0.98, reasoning: 0.98 },
    pricing: { inputPerMillionUsd: 5, outputPerMillionUsd: 15 }, contextWindow: 200_000,
    maxOutputTokens: 16_000, regions: ['global', 'us', 'eu'], allowedDataClasses: ['public', 'internal', 'confidential', 'restricted'], health,
  },
];
