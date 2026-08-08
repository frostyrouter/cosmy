import type { ResponseCache } from './contracts.js';

interface Entry { value: string; expiresAt: number; }

const MAX_ENTRIES = 10_000;

export class InMemoryResponseCache implements ResponseCache {
  private readonly entries = new Map<string, Entry>();

  async get(key: string): Promise<{ value: string; expiresAt: string } | undefined> {
    const entry = this.entries.get(key);
    if (!entry || entry.expiresAt <= Date.now()) { this.entries.delete(key); return undefined; }
    return { value: entry.value, expiresAt: new Date(entry.expiresAt).toISOString() };
  }
  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (!this.entries.has(key)) {
      while (this.entries.size >= MAX_ENTRIES) this.entries.delete(this.entries.keys().next().value as string);
    }
    this.entries.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1_000 });
  }
  async delete(key: string): Promise<void> { this.entries.delete(key); }
}
