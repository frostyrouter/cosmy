import type { ResponseResult } from '../domain/types.js';
import type { IdempotencyClaim, IdempotencyStore } from './contracts.js';

interface Entry { requestHash: string; expiresAt: number; response?: ResponseResult; }

const MAX_ENTRIES = 10_000;

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly entries = new Map<string, Entry>();

  private compoundKey(tenantId: string, key: string): string { return `${tenantId}\u0000${key}`; }

  async claim(tenantId: string, key: string, requestHash: string, ttlSeconds: number): Promise<IdempotencyClaim> {
    const compound = this.compoundKey(tenantId, key);
    const existing = this.entries.get(compound);
    if (existing && existing.expiresAt <= Date.now()) this.entries.delete(compound);
    else if (existing && existing.requestHash !== requestHash) return { status: 'conflict' };
    else if (existing?.response) return { status: 'replay', response: existing.response };
    else if (existing) return { status: 'in-progress' };

    if (this.entries.size >= MAX_ENTRIES) {
      const completed = [...this.entries].find(([, entry]) => entry.response !== undefined);
      if (!completed) throw new Error('Idempotency store is at capacity with active claims');
      this.entries.delete(completed[0]);
    }
    this.entries.set(compound, { requestHash, expiresAt: Date.now() + ttlSeconds * 1_000 });
    return { status: 'claimed' };
  }

  async complete(tenantId: string, key: string, requestHash: string, response: ResponseResult): Promise<void> {
    const existing = this.entries.get(this.compoundKey(tenantId, key));
    if (!existing || existing.requestHash !== requestHash) throw new Error('Idempotency claim was not available for completion');
    existing.response = structuredClone(response);
  }

  async release(tenantId: string, key: string, requestHash: string): Promise<void> {
    const compound = this.compoundKey(tenantId, key);
    if (this.entries.get(compound)?.requestHash === requestHash) this.entries.delete(compound);
  }
}
