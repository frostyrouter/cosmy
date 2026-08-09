import { describe, expect, it } from 'vitest';
import { InMemoryUsageLedger } from '../src/stores/memory-usage-ledger.js';

describe('usage ledger', () => {
  it('reserves within a tenant budget and rejects the next request', async () => {
    const ledger = new InMemoryUsageLedger({ acme: 0.01 });
    const reservation = await ledger.reserve({ tenantId: 'acme', estimatedCostUsd: 0.006 });
    await expect(ledger.reserve({ tenantId: 'acme', estimatedCostUsd: 0.005 })).rejects.toThrow('budget');
    await ledger.reconcile(reservation, 0.004);
    expect(ledger.spentFor('acme')).toBe(0.004);
    expect(ledger.reservedFor('acme')).toBe(0);
    await expect(ledger.reserve({ tenantId: 'acme', estimatedCostUsd: 0.005 })).resolves.toBeTruthy();
  });

  it('applies the wildcard budget to tenants without an explicit limit', async () => {
    const ledger = new InMemoryUsageLedger({ '*': 0.01 });
    const reservation = await ledger.reserve({ tenantId: 'other-tenant', estimatedCostUsd: 0.006 });
    await expect(ledger.reserve({ tenantId: 'other-tenant', estimatedCostUsd: 0.005 })).rejects.toThrow('budget');
    await ledger.reconcile(reservation, 0.004);
    await expect(ledger.reserve({ tenantId: 'other-tenant', estimatedCostUsd: 0.005 })).resolves.toBeTruthy();
  });

  it('rejects an administrative limit below existing usage', async () => {
    const ledger = new InMemoryUsageLedger();
    const reservation = await ledger.reserve({ tenantId: 'acme', estimatedCostUsd: 0.006 });
    await expect(ledger.setBudget('acme', 0.005)).rejects.toMatchObject({ code: 'budget_below_usage', statusCode: 409 });
    expect((await ledger.budgetFor('acme')).limitUsd).toBeUndefined();
    await ledger.reconcile(reservation, 0.004);
    await expect(ledger.setBudget('acme', 0.003)).rejects.toMatchObject({ code: 'budget_below_usage', statusCode: 409 });
  });
});
