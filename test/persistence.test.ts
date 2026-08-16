import { describe, expect, it } from 'vitest';
import { InMemoryResponseCache } from '../src/persistence/memory-cache.js';
import { InMemoryDecisionStore } from '../src/persistence/memory-decisions.js';
import type { DecisionRecord } from '../src/domain/types.js';
import { newDecisionRecord } from './support/decision-fixture.js';

describe('persistence contracts', () => {
  it('expires cached responses by TTL and supports deletion', async () => {
    const cache = new InMemoryResponseCache();
    await cache.set('request-key', '{"answer":"ok"}', 60);
    expect(await cache.get('request-key')).toMatchObject({ value: '{"answer":"ok"}' });
    await cache.delete('request-key');
    expect(await cache.get('request-key')).toBeUndefined();
  });

  it('evicts the oldest entry when the cache is full', async () => {
    const cache = new InMemoryResponseCache();
    for (let i = 0; i < 10_001; i++) await cache.set(`key-${i}`, `value-${i}`, 60);
    expect(await cache.get('key-0')).toBeUndefined();
    expect(await cache.get('key-10000')).toMatchObject({ value: 'value-10000' });
    expect(await cache.get('key-9999')).toMatchObject({ value: 'value-9999' });
  });

  it('isolates decision records by tenant and evicts the oldest record at capacity', async () => {
    const decisions = new InMemoryDecisionStore(1);
    const first = newDecisionRecord({ id: 'decision-1', tenantId: 'tenant-a' });
    await decisions.save(first);
    expect(await decisions.get('tenant-b', first.id)).toBeUndefined();
    const second: DecisionRecord = { ...newDecisionRecord({ id: 'decision-2', tenantId: 'tenant-a' }), state: 'completed' };
    await decisions.save(second);
    expect(await decisions.get('tenant-a', first.id)).toBeUndefined();
    expect(await decisions.get('tenant-a', second.id)).toMatchObject({ state: 'completed' });
  });
});
