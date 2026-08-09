import { describe, expect, it } from 'vitest';
import { InMemoryResponseCache } from '../src/persistence/memory-cache.js';

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
});
