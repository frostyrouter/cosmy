import { describe, expect, it } from 'vitest';
import { ProviderError, RequestCancelledError } from '../src/domain/errors.js';
import { defaultModels } from '../src/registry/default-models.js';
import { InMemoryUsageLedger } from '../src/stores/memory-usage-ledger.js';
import { InMemoryModelRegistry } from '../src/registry/memory-registry.js';
import { InMemoryHealthStore } from '../src/stores/memory-health-store.js';
import { DeterministicRouter } from '../src/routing/router.js';
import { RequestExecutor } from '../src/execution/executor.js';
import { SimulatorProvider } from '../src/providers/simulator.js';
import type { ProviderAdapter } from '../src/ports/provider.js';

describe('usage reconciliation', () => {
  it('releases the reservation when a provider fails', async () => {
    const registry = new InMemoryModelRegistry(defaultModels);
    const route = new DeterministicRouter(registry).decide('req_failure', { messages: [{ role: 'user', content: 'hello' }] });
    const ledger = new InMemoryUsageLedger({ default: 0.01 });
    const failing: ProviderAdapter = {
      name: 'simulator', listModels: () => defaultModels,
      complete: async () => { throw new Error('provider unavailable'); },
      stream: async function* () { throw new Error('provider unavailable'); },
    };
    const executor = new RequestExecutor([failing], ledger, new InMemoryHealthStore());
    await expect(executor.execute({ requestId: 'req_failure', route, request: { messages: [{ role: 'user', content: 'hello' }] }, signal: new AbortController().signal })).rejects.toThrow('provider unavailable');
    expect(ledger.reservedFor('default')).toBe(0);
    await expect(ledger.reserve({ tenantId: 'default', estimatedCostUsd: 0.009 })).resolves.toBeTruthy();
  });

  it('counts simulator input and output tokens in total usage', async () => {
    const provider = new SimulatorProvider([defaultModels[0]!]);
    const response = await provider.complete({ request: { messages: [{ role: 'user', content: 'hello' }] }, model: defaultModels[0]!, signal: new AbortController().signal });
    expect(response.usage.totalTokens).toBe(response.usage.inputTokens + response.usage.outputTokens);
    expect(response.usage.inputTokens).toBeGreaterThan(0);
  });

  it('does not fail a successful request when usage reconciliation fails', async () => {
    const registry = new InMemoryModelRegistry(defaultModels);
    const route = new DeterministicRouter(registry).decide('req_reconcile', { messages: [{ role: 'user', content: 'hello' }] });
    const ledger = { reserve: async () => ({ id: 'r1', tenantId: 'default', estimatedCostUsd: 0.001 }), reconcile: async () => { throw new Error('store unavailable'); } } as unknown as import('../src/ports/stores.js').UsageLedger;
    const health = new InMemoryHealthStore();
    const providers: ProviderAdapter[] = [{ name: 'simulator', listModels: () => defaultModels, complete: async () => ({ output: 'ok', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimatedCostUsd: 0 }, finishReason: 'stop' }), stream: async function* () {} }];
    const executor = new RequestExecutor(providers, ledger, health);
    const result = await executor.execute({ requestId: 'req_reconcile', route, request: { messages: [{ role: 'user', content: 'hello' }] }, signal: new AbortController().signal });
    expect(result.output).toBe('ok');
    expect(health.stats(route.selected.model.id)).toEqual({ successes: 1, failures: 0 });
  });

  it('preserves the provider error when reconciliation fails on the error path', async () => {
    const registry = new InMemoryModelRegistry(defaultModels);
    const route = new DeterministicRouter(registry).decide('req_reconcile_fail', { messages: [{ role: 'user', content: 'hello' }] });
    const ledger = { reserve: async () => ({ id: 'r2', tenantId: 'default', estimatedCostUsd: 0.001 }), reconcile: async () => { throw new Error('store unavailable'); } } as unknown as import('../src/ports/stores.js').UsageLedger;
    const providers: ProviderAdapter[] = [{ name: 'simulator', listModels: () => defaultModels, complete: async () => { throw new ProviderError('original outage', true); }, stream: async function* () { throw new ProviderError('original outage', true); } }];
    const executor = new RequestExecutor(providers, ledger, new InMemoryHealthStore());
    await expect(executor.execute({ requestId: 'req_reconcile_fail', route, request: { messages: [{ role: 'user', content: 'hello' }] }, signal: new AbortController().signal })).rejects.toThrow('original outage');
  });

  it('stops a live stream when its reservation lease cannot be renewed', async () => {
    const registry = new InMemoryModelRegistry(defaultModels);
    const route = new DeterministicRouter(registry).decide('req_heartbeat', { stream: true, messages: [{ role: 'user', content: 'hello' }] });
    const reconciliations: number[] = [];
    const ledger = {
      reserve: async () => ({ id: 'r3', tenantId: 'default', estimatedCostUsd: 0.001 }),
      reconcile: async (_reservation, actualCostUsd) => { reconciliations.push(actualCostUsd); },
      heartbeat: async () => { throw new Error('database unavailable'); },
    } as import('../src/ports/stores.js').UsageLedger;
    const provider: ProviderAdapter = {
      name: 'simulator', listModels: () => defaultModels,
      complete: async () => { throw new Error('unused'); },
      stream: async function* ({ signal }) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 100);
          signal.addEventListener('abort', () => { clearTimeout(timer); reject(new RequestCancelledError()); }, { once: true });
        });
        yield { requestId: 'req_heartbeat', index: 0, delta: 'late', done: false };
      },
    };
    const executor = new RequestExecutor([provider], ledger, new InMemoryHealthStore(), undefined, undefined, 5);
    const consume = async () => { for await (const _chunk of executor.stream({ requestId: 'req_heartbeat', route, request: { stream: true, messages: [{ role: 'user', content: 'hello' }] }, signal: new AbortController().signal })) { /* consume */ } };
    await expect(consume()).rejects.toMatchObject({ code: 'reservation_heartbeat_failed', statusCode: 503 });
    expect(reconciliations).toEqual([0.001]);
  });
});
