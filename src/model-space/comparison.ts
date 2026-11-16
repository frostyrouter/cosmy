import type { ModelConfiguration } from '../domain/types.js';

const axes = [
  { id: 'quality', label: 'Quality', direction: 'higher_is_better' },
  { id: 'reasoning', label: 'Reasoning', direction: 'higher_is_better' },
  { id: 'technicality', label: 'Technical capability', direction: 'higher_is_better' },
  { id: 'creativity', label: 'Creativity', direction: 'higher_is_better' },
  { id: 'affordability', label: 'Affordability', direction: 'higher_is_better' },
  { id: 'speed', label: 'Speed', direction: 'higher_is_better' },
  { id: 'reliability', label: 'Reliability', direction: 'higher_is_better' },
  { id: 'context', label: 'Context capacity', direction: 'higher_is_better' },
] as const;

function clamp(value: number): number { return Math.max(0, Math.min(1, value)); }

function rounded(value: number): number { return Math.round(value * 1_000) / 1_000; }

function averageTokenPrice(model: ModelConfiguration): number {
  return (model.pricing.inputPerMillionUsd + model.pricing.outputPerMillionUsd) / 2;
}

export function modelSpaceComparison(models: readonly ModelConfiguration[]) {
  const enabled = models.filter((model) => model.enabled).slice().sort((left, right) => left.id.localeCompare(right.id));
  const positivePrices = enabled.map(averageTokenPrice).filter((value) => value > 0);
  const lowestPrice = positivePrices.length ? Math.min(...positivePrices) : 0;
  const fastestLatency = Math.min(...enabled.map((model) => model.health.latencyP95Ms).filter((value) => value > 0));
  const largestContext = Math.max(0, ...enabled.map((model) => model.contextWindow));

  return {
    schemaVersion: 'v1',
    dataStatus: 'demo',
    source: 'registry-priors',
    disclaimer: 'Comparison scores are demonstration values derived from configured model profiles; they are not production evaluation results.',
    scale: { minimum: 0, maximum: 1 },
    axes,
    models: enabled.map((model) => {
      const averagePrice = averageTokenPrice(model);
      const reliability = model.health.availability * (1 - model.health.errorRate);
      return {
        modelId: model.id,
        label: model.model,
        provider: model.provider,
        version: model.version,
        values: {
          quality: rounded(clamp(model.coordinates.quality)),
          reasoning: rounded(clamp(model.coordinates.reasoning)),
          technicality: rounded(clamp(model.coordinates.technicality)),
          creativity: rounded(clamp(model.coordinates.creativity)),
          affordability: rounded(averagePrice <= 0 || lowestPrice === 0 ? 1 : clamp(lowestPrice / averagePrice)),
          speed: rounded(Number.isFinite(fastestLatency) && model.health.latencyP95Ms > 0 ? clamp(fastestLatency / model.health.latencyP95Ms) : 0),
          reliability: rounded(clamp(reliability)),
          context: rounded(largestContext === 0 ? 0 : clamp(model.contextWindow / largestContext)),
        },
        raw: {
          inputPerMillionUsd: model.pricing.inputPerMillionUsd,
          outputPerMillionUsd: model.pricing.outputPerMillionUsd,
          latencyP95Ms: model.health.latencyP95Ms,
          availability: model.health.availability,
          errorRate: model.health.errorRate,
          contextWindow: model.contextWindow,
          maxOutputTokens: model.maxOutputTokens,
        },
      };
    }),
  };
}

export type ModelSpaceComparison = ReturnType<typeof modelSpaceComparison>;

export interface ModelSpaceSource {
  compare(models: readonly ModelConfiguration[]): ModelSpaceComparison | Promise<ModelSpaceComparison>;
}

export const registryPriorModelSpaceSource: ModelSpaceSource = { compare: modelSpaceComparison };
