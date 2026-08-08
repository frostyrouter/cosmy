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
});
