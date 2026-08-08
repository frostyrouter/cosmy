import type { ModelConfiguration, ResponseChunk } from '../domain/types.js';
import type { ProviderAdapter, ProviderRequest, ProviderResponse } from '../ports/provider.js';
import { ProviderError, RequestCancelledError } from '../domain/errors.js';

function outputFor(request: ProviderRequest): string {
  const prompt = request.request.messages.at(-1)?.content ?? '';
  if (prompt.toLowerCase().includes('rewrite')) return `Rewritten: ${prompt.replace(/rewrite:?/iu, '').trim()}`;
  if (prompt.toLowerCase().includes('json')) return JSON.stringify({ answer: 'simulated response', source: 'simulator' });
  return `Simulated response for: ${prompt}`;
}

function tokenCount(value: string): number { return Math.max(1, Math.ceil(value.length / 4)); }

function inputTokenCount(input: ProviderRequest): number {
  return input.request.messages.reduce((sum, message) => sum + tokenCount(message.content), 0);
}

export class SimulatorProvider implements ProviderAdapter {
  readonly name = 'simulator';

  constructor(private readonly models: readonly ModelConfiguration[], private readonly delayMs = 0) {}

  listModels(): readonly ModelConfiguration[] { return this.models; }

  async complete(input: ProviderRequest): Promise<ProviderResponse> {
    if (input.signal.aborted) throw new RequestCancelledError();
    await this.delay(input.signal);
    const output = outputFor(input);
    return {
      output,
      usage: { inputTokens: inputTokenCount(input), outputTokens: tokenCount(output), totalTokens: inputTokenCount(input) + tokenCount(output), estimatedCostUsd: 0 },
      finishReason: 'stop',
    };
  }

  async *stream(input: ProviderRequest): AsyncIterable<ResponseChunk> {
    if (input.signal.aborted) throw new RequestCancelledError();
    const output = outputFor(input);
    const pieces = output.split(/(\s+)/u).filter(Boolean);
    for (const [index, delta] of pieces.entries()) {
      if (input.signal.aborted) throw new RequestCancelledError();
      await this.delay(input.signal);
      yield { requestId: input.request.requestId ?? 'unknown', index, delta, done: false };
    }
    const outputTokens = tokenCount(output);
    const inputTokens = inputTokenCount(input);
    yield { requestId: input.request.requestId ?? 'unknown', index: pieces.length, delta: '', done: true, usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, estimatedCostUsd: 0 } };
  }

  private delay(signal: AbortSignal): Promise<void> {
    if (this.delayMs <= 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, this.delayMs);
      signal.addEventListener('abort', () => { clearTimeout(timer); reject(new RequestCancelledError()); }, { once: true });
    });
  }
}

export function providerForModel(providers: readonly ProviderAdapter[], model: ModelConfiguration): ProviderAdapter {
  const provider = providers.find((candidate) => candidate.name === model.provider);
  if (!provider) throw new ProviderError(`Provider '${model.provider}' is not configured`, false);
  return provider;
}
