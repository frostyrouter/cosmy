import { describe, expect, it } from 'vitest';
import { ProviderError, RequestCancelledError } from '../src/domain/errors.js';
import { ResilientProvider } from '../src/execution/resilience.js';
import type { ProviderAdapter } from '../src/ports/provider.js';
import { defaultModels } from '../src/registry/default-models.js';

const model = defaultModels[0]!;
const request = { request: { messages: [{ role: 'user' as const, content: 'hello' }] }, model, signal: new AbortController().signal };

describe('provider resilience', () => {
  it('retries transient completion failures and succeeds', async () => {
    let calls = 0;
    const provider: ProviderAdapter = { name: 'simulator', listModels: () => [model], complete: async () => { calls += 1; if (calls < 3) throw new ProviderError('temporary', true); return { output: 'ok', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimatedCostUsd: 0 }, finishReason: 'stop' }; }, stream: async function* () {} };
    const result = await new ResilientProvider(provider, { maxRetries: 2, timeoutMs: 1_000, baseDelayMs: 0 }).complete(request);
    expect(result.output).toBe('ok');
    expect(calls).toBe(3);
  });

  it('does not retry non-retryable failures', async () => {
    let calls = 0;
    const provider: ProviderAdapter = { name: 'simulator', listModels: () => [model], complete: async () => { calls += 1; throw new ProviderError('bad request', false); }, stream: async function* () {} };
    await expect(new ResilientProvider(provider, { maxRetries: 3, timeoutMs: 1_000, baseDelayMs: 0 }).complete(request)).rejects.toThrow('bad request');
    expect(calls).toBe(1);
  });

  it('applies the attempt timeout only until the first streamed chunk', async () => {
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const provider: ProviderAdapter = { name: 'simulator', listModels: () => [model], complete: async () => ({ output: 'ok', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimatedCostUsd: 0 }, finishReason: 'stop' }), stream: async function* () {
      yield { requestId: 'req_stream_timeout', index: 0, delta: 'first', done: false };
      await delay(120);
      yield { requestId: 'req_stream_timeout', index: 1, delta: ' second', done: false };
    } };
    const resilient = new ResilientProvider(provider, { maxRetries: 0, timeoutMs: 50, baseDelayMs: 0 });
    const chunks: string[] = [];
    for await (const chunk of resilient.stream({ request: { requestId: 'req_stream_timeout', messages: [{ role: 'user', content: 'hi' }] }, model, signal: new AbortController().signal })) chunks.push(chunk.delta);
    expect(chunks).toEqual(['first', ' second']);
  });

  it('does not count client cancellations toward the circuit breaker', async () => {
    const provider: ProviderAdapter = { name: 'simulator', listModels: () => [model], complete: async (input) => { if (input.signal.aborted) throw new RequestCancelledError(); return { output: 'ok', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimatedCostUsd: 0 }, finishReason: 'stop' }; }, stream: async function* () {} };
    const resilient = new ResilientProvider(provider, { maxRetries: 0, timeoutMs: 1_000, baseDelayMs: 0, failureThreshold: 3, cooldownMs: 60_000 });
    const cancelled = new AbortController();
    cancelled.abort();
    for (let i = 0; i < 5; i++) {
      await expect(resilient.complete({ ...request, signal: cancelled.signal })).rejects.toThrow('cancelled');
    }
    const result = await resilient.complete(request);
    expect(result.output).toBe('ok');
  });
});
