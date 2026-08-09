import { describe, expect, it } from 'vitest';
import type { ResponseResult } from '../src/domain/types.js';
import { InMemoryIdempotencyStore } from '../src/persistence/memory-idempotency.js';

const response = { requestId: 'request-1', output: 'done' } as ResponseResult;

describe('in-memory idempotency store', () => {
  it('claims, blocks concurrent work, and replays a completed response', async () => {
    const store = new InMemoryIdempotencyStore();
    await expect(store.claim('tenant-a', 'key-1', 'hash-1', 60)).resolves.toEqual({ status: 'claimed' });
    await expect(store.claim('tenant-a', 'key-1', 'hash-1', 60)).resolves.toEqual({ status: 'in-progress' });
    await store.complete('tenant-a', 'key-1', 'hash-1', response);
    await expect(store.claim('tenant-a', 'key-1', 'hash-1', 60)).resolves.toEqual({ status: 'replay', response });
  });

  it('isolates tenants, detects key reuse, and releases failed claims', async () => {
    const store = new InMemoryIdempotencyStore();
    await store.claim('tenant-a', 'shared-key', 'hash-1', 60);
    await expect(store.claim('tenant-a', 'shared-key', 'hash-2', 60)).resolves.toEqual({ status: 'conflict' });
    await expect(store.claim('tenant-b', 'shared-key', 'hash-2', 60)).resolves.toEqual({ status: 'claimed' });
    await store.release('tenant-a', 'shared-key', 'hash-1');
    await expect(store.claim('tenant-a', 'shared-key', 'hash-2', 60)).resolves.toEqual({ status: 'claimed' });
  });
});
