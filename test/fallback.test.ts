import { describe, expect, it } from 'vitest';
import { ProviderError, RequestCancelledError } from '../src/domain/errors.js';
import { RequestExecutor } from '../src/execution/executor.js';
import { InMemoryMetrics } from '../src/observability/metrics.js';
import { InMemoryModelRegistry } from '../src/registry/memory-registry.js';
import { DeterministicRouter } from '../src/routing/router.js';
import { InMemoryHealthStore } from '../src/stores/memory-health-store.js';
import { InMemoryUsageLedger } from '../src/stores/memory-usage-ledger.js';
import { ResilientProvider } from '../src/execution/resilience.js';
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

  it('falls back to the next candidate while the primary provider circuit is open', async () => {
    const first = { ...defaultModels[0]!, id: 'first', provider: 'first' };
    const second = { ...defaultModels[1]!, id: 'second', provider: 'second' };
    const registry = new InMemoryModelRegistry([first, second]);
    const router = new DeterministicRouter(registry);
    const failing = async () => { throw new ProviderError('outage', true); };
    const providers: ProviderAdapter[] = [
      { name: 'first', listModels: () => [first], complete: failing, stream: async function* () { throw new ProviderError('outage', true); } },
      { name: 'second', listModels: () => [second], complete: async () => ({ output: 'fallback', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimatedCostUsd: 0 }, finishReason: 'stop' }), stream: async function* () {} },
    ];
    const resilient = providers.map((provider) => new ResilientProvider(provider, { maxRetries: 0, timeoutMs: 500, baseDelayMs: 0, failureThreshold: 3, cooldownMs: 60_000 }));
    const executor = new RequestExecutor(resilient, new InMemoryUsageLedger(), new InMemoryHealthStore(), new InMemoryMetrics());
    const request = { messages: [{ role: 'user' as const, content: 'hello' }] };
    for (let i = 0; i < 3; i++) {
      const result = await executor.execute({ requestId: `req_open_${i}`, route: router.decide(`req_open_${i}`, request), request, signal: new AbortController().signal });
      expect(result.provider).toBe('second');
    }
    const result = await executor.execute({ requestId: 'req_open_4', route: router.decide('req_open_4', request), request, signal: new AbortController().signal });
    expect(result.provider).toBe('second');
    expect(result.output).toBe('fallback');
  });

  it('bounds total request wall time with an overall deadline', async () => {
    const first = { ...defaultModels[0]!, id: 'first', provider: 'first' };
    const second = { ...defaultModels[1]!, id: 'second', provider: 'second' };
    const registry = new InMemoryModelRegistry([first, second]);
    const route = new DeterministicRouter(registry).decide('req_deadline', { messages: [{ role: 'user', content: 'hello' }] });
    const slowFailure = (input: import('../src/ports/provider.js').ProviderRequest): Promise<never> => new Promise((_resolve, reject) => {
      const timer = setTimeout(() => reject(new ProviderError('slow outage', true)), 400);
      input.signal.addEventListener('abort', () => { clearTimeout(timer); reject(new RequestCancelledError()); }, { once: true });
    });
    const providers: ProviderAdapter[] = [
      { name: 'first', listModels: () => [first], complete: slowFailure, stream: async function* () { throw new ProviderError('x', true); } },
      { name: 'second', listModels: () => [second], complete: slowFailure, stream: async function* () { throw new ProviderError('x', true); } },
    ];
    const resilient = providers.map((provider) => new ResilientProvider(provider, { maxRetries: 2, timeoutMs: 300, baseDelayMs: 0 }));
    const executor = new RequestExecutor(resilient, new InMemoryUsageLedger(), new InMemoryHealthStore(), undefined, 150);
    const request = { messages: [{ role: 'user' as const, content: 'hello' }] };
    const started = Date.now();
    await expect(executor.execute({ requestId: 'req_deadline', route, request, signal: new AbortController().signal })).rejects.toMatchObject({ code: 'timeout', statusCode: 504 });
    expect(Date.now() - started).toBeLessThan(300);
  });

  it('does not let a stalled rollout observation hang a completed response', async () => {
    const model = { ...defaultModels[0]!, id: 'observed', provider: 'observed' };
    const route = new DeterministicRouter(new InMemoryModelRegistry([model])).decide('req_observation', { messages: [{ role: 'user', content: 'hello' }] });
    const provider: ProviderAdapter = { name: 'observed', listModels: () => [model], complete: async () => ({ output: 'done', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimatedCostUsd: 0 }, finishReason: 'stop' }), stream: async function* () {} };
    const metrics = new InMemoryMetrics();
    const executor = new RequestExecutor([provider], new InMemoryUsageLedger(), new InMemoryHealthStore(), metrics, undefined, 30_000, { recordOutcome: () => new Promise<void>(() => {}) });
    const started = Date.now();
    await expect(executor.execute({ requestId: 'req_observation', route, request: { messages: [{ role: 'user', content: 'hello' }] }, signal: new AbortController().signal })).resolves.toMatchObject({ output: 'done' });
    expect(Date.now() - started).toBeLessThan(500);
    expect(metrics.snapshot().operational.rollout_observation_failure).toBe(1);
  });

  it('records a completed stream as success and reconciles the estimate when usage is missing', async () => {
    const first = { ...defaultModels[0]!, id: 'first', provider: 'first' };
    const registry = new InMemoryModelRegistry([first]);
    const route = new DeterministicRouter(registry).decide('req_nousage', { stream: true, messages: [{ role: 'user', content: 'hello' }] });
    const providers: ProviderAdapter[] = [
      { name: 'first', listModels: () => [first], complete: async () => ({ output: 'unused', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimatedCostUsd: 0 }, finishReason: 'stop' }), stream: async function* () { yield { requestId: 'req_nousage', index: 0, delta: 'ok', done: false }; yield { requestId: 'req_nousage', index: 1, delta: '', done: true }; } },
    ];
    const ledger = new InMemoryUsageLedger();
    const health = new InMemoryHealthStore();
    const metrics = new InMemoryMetrics();
    const executor = new RequestExecutor(providers, ledger, health, metrics);
    const chunks: string[] = [];
    for await (const chunk of executor.stream({ requestId: 'req_nousage', route, request: { stream: true, messages: [{ role: 'user', content: 'hello' }] }, signal: new AbortController().signal })) chunks.push(chunk.delta);
    expect(chunks).toEqual(['ok', '']);
    expect(health.stats('first').successes).toBe(1);
    expect(metrics.snapshot().successes).toBe(1);
    expect(ledger.spentFor('default')).toBe(route.selected.estimatedCostUsd);
    expect(ledger.reservedFor('default')).toBe(0);
  });
});
