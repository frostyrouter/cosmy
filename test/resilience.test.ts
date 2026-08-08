import { describe, expect, it } from 'vitest';
import { ProviderError } from '../src/domain/errors.js';
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
});
