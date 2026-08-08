import { describe, expect, it } from 'vitest';
import { ProviderError } from '../src/domain/errors.js';
import { RequestExecutor } from '../src/execution/executor.js';
import { InMemoryMetrics } from '../src/observability/metrics.js';
import { InMemoryModelRegistry } from '../src/registry/memory-registry.js';
import { DeterministicRouter } from '../src/routing/router.js';
import { InMemoryHealthStore } from '../src/stores/memory-health-store.js';
import { InMemoryUsageLedger } from '../src/stores/memory-usage-ledger.js';
import type { ProviderAdapter } from '../src/ports/provider.js';
import { defaultModels } from '../src/registry/default-models.js';

describe('fallback execution and metrics', () => {
  it('uses the next eligible candidate after a retryable provider failure', async () => {
    const first = { ...defaultModels[0]!, id: 'first', provider: 'first' };
    const second = { ...defaultModels[1]!, id: 'second', provider: 'second' };
    const registry = new InMemoryModelRegistry([first, second]);
    const route = new DeterministicRouter(registry).decide('req_fallback', { messages: [{ role: 'user', content: 'hello' }] });
    const providers: ProviderAdapter[] = [
      { name: 'first', listModels: () => [first], complete: async () => { throw new ProviderError('upstream unavailable', true); }, stream: async function* () { throw new ProviderError('upstream unavailable', true); } },
      { name: 'second', listModels: () => [second], complete: async () => ({ output: 'fallback', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimatedCostUsd: 0 }, finishReason: 'stop' }), stream: async function* () {} },
    ];
    const metrics = new InMemoryMetrics();
    const executor = new RequestExecutor(providers, new InMemoryUsageLedger(), new InMemoryHealthStore(), metrics);
    const result = await executor.execute({ requestId: 'req_fallback', route, request: { messages: [{ role: 'user', content: 'hello' }] }, signal: new AbortController().signal });
    expect(result.output).toBe('fallback');
    expect(result.provider).toBe('second');
    expect(metrics.snapshot()).toMatchObject({ requests: 2, successes: 1, errors: 1, fallbacks: 1 });
  });

  it('does not fallback after a stream has emitted output', async () => {
    const first = { ...defaultModels[0]!, id: 'first', provider: 'first' };
    const second = { ...defaultModels[1]!, id: 'second', provider: 'second' };
    const route = new DeterministicRouter(new InMemoryModelRegistry([first, second])).decide('req_stream', { stream: true, messages: [{ role: 'user', content: 'hello' }] });
    const providers: ProviderAdapter[] = [
      { name: 'first', listModels: () => [first], complete: async () => { throw new Error('unused'); }, stream: async function* () { yield { requestId: 'req_stream', index: 0, delta: 'partial', done: false }; throw new ProviderError('stream interrupted', true); } },
      { name: 'second', listModels: () => [second], complete: async () => { throw new Error('unused'); }, stream: async function* () { yield { requestId: 'req_stream', index: 0, delta: 'fallback', done: false }; } },
    ];
    const executor = new RequestExecutor(providers, new InMemoryUsageLedger(), new InMemoryHealthStore());
    const chunks: string[] = [];
    await expect((async () => { for await (const chunk of executor.stream({ requestId: 'req_stream', route, request: { stream: true, messages: [{ role: 'user', content: 'hello' }] }, signal: new AbortController().signal })) chunks.push(chunk.delta); })()).rejects.toThrow('stream interrupted');
    expect(chunks).toEqual(['partial']);
  });
});
