import type { ResponseCache } from './contracts.js';

interface Entry { value: string; expiresAt: number; }

export class InMemoryResponseCache implements ResponseCache {
  private readonly entries = new Map<string, Entry>();

  async get(key: string): Promise<{ value: string; expiresAt: string } | undefined> {
    const entry = this.entries.get(key);
    if (!entry || entry.expiresAt <= Date.now()) { this.entries.delete(key); return undefined; }
    return { value: entry.value, expiresAt: new Date(entry.expiresAt).toISOString() };
  }
  async set(key: string, value: string, ttlSeconds: number): Promise<void> { this.entries.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1_000 }); }
  async delete(key: string): Promise<void> { this.entries.delete(key); }
}
