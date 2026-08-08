import type { DataClass, ModelConfiguration } from '../domain/types.js';
import type { ProviderAdapter } from '../ports/provider.js';
import { AnthropicProvider } from './anthropic.js';
import { GeminiProvider } from './gemini.js';
import { OpenAIProvider } from './openai.js';
import { SimulatorProvider } from './simulator.js';

type ExternalProvider = 'openai' | 'anthropic' | 'gemini';

const publicData: DataClass[] = ['public', 'internal', 'confidential'];
const sharedHealth = { availability: 0.99, latencyP95Ms: 1_500, errorRate: 0.01, checkedAt: 'startup' };

function numeric(value: string | undefined, fallback: number): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function manifest(provider: ExternalProvider, model: string, env: NodeJS.ProcessEnv): ModelConfiguration {
  const prefix = provider.toUpperCase();
  return {
    id: `${provider}:${model}`, provider, model, version: env[`${prefix}_MODEL_VERSION`] ?? 'configured', enabled: true,
    capabilities: ['streaming', 'tools', 'structured-output', 'reasoning'], modalities: ['text'],
    coordinates: { technicality: numeric(env[`${prefix}_TECHNICALITY`], 0.7), creativity: numeric(env[`${prefix}_CREATIVITY`], 0.65), quality: numeric(env[`${prefix}_QUALITY`], 0.8), reasoning: numeric(env[`${prefix}_REASONING`], 0.75) },
    pricing: { inputPerMillionUsd: numeric(env[`${prefix}_INPUT_PRICE_PER_MTOK`], 1), outputPerMillionUsd: numeric(env[`${prefix}_OUTPUT_PRICE_PER_MTOK`], 3) },
    contextWindow: numeric(env[`${prefix}_CONTEXT_WINDOW`], 128_000), maxOutputTokens: numeric(env[`${prefix}_MAX_OUTPUT_TOKENS`], 8_000),
    regions: (env[`${prefix}_REGIONS`] ?? 'global').split(',').map((value) => value.trim()).filter(Boolean), allowedDataClasses: publicData, health: sharedHealth,
  };
}

export function configuredModelManifests(env: NodeJS.ProcessEnv = process.env): ModelConfiguration[] {
  const entries: Array<[ExternalProvider, string | undefined]> = [['openai', env.OPENAI_MODEL], ['anthropic', env.ANTHROPIC_MODEL], ['gemini', env.GEMINI_MODEL]];
  return entries.filter((entry): entry is [ExternalProvider, string] => Boolean(env[`${entry[0].toUpperCase()}_API_KEY`] && entry[1])).map(([provider, model]) => manifest(provider, model, env));
}

export function configuredProviders(env: NodeJS.ProcessEnv, models: readonly ModelConfiguration[]): ProviderAdapter[] {
  const providers: ProviderAdapter[] = [new SimulatorProvider(models.filter((model) => model.provider === 'simulator'))];
  const byProvider = (provider: ExternalProvider) => models.filter((model) => model.provider === provider);
  if (env.OPENAI_API_KEY) providers.push(new OpenAIProvider({ apiKey: env.OPENAI_API_KEY, ...(env.OPENAI_BASE_URL ? { baseUrl: env.OPENAI_BASE_URL } : {}) }, byProvider('openai')));
  if (env.ANTHROPIC_API_KEY) providers.push(new AnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, ...(env.ANTHROPIC_BASE_URL ? { baseUrl: env.ANTHROPIC_BASE_URL } : {}) }, byProvider('anthropic')));
  if (env.GEMINI_API_KEY) providers.push(new GeminiProvider({ apiKey: env.GEMINI_API_KEY, ...(env.GEMINI_BASE_URL ? { baseUrl: env.GEMINI_BASE_URL } : {}) }, byProvider('gemini')));
  return providers;
}
