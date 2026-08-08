import { describe, expect, it } from 'vitest';
import { InMemoryUsageLedger } from '../src/stores/memory-usage-ledger.js';

describe('usage ledger', () => {
  it('reserves within a tenant budget and rejects the next request', async () => {
    const ledger = new InMemoryUsageLedger({ acme: 0.01 });
    await ledger.reserve({ tenantId: 'acme', estimatedCostUsd: 0.006 });
    await expect(ledger.reserve({ tenantId: 'acme', estimatedCostUsd: 0.005 })).rejects.toThrow('budget');
    await ledger.record({ tenantId: 'acme', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimatedCostUsd: 0.004 } });
    expect(ledger.spentFor('acme')).toBe(0.004);
  });
});
