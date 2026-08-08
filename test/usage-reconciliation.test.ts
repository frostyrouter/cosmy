import { describe, expect, it } from 'vitest';
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
});
