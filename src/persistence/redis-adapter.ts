import type { ResponseCache } from './contracts.js';

export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { EX?: number }): Promise<unknown>;
  del(key: string): Promise<number>;
}

interface CachedValue { value: string; expiresAt: string; }

export class RedisResponseCache implements ResponseCache {
  constructor(private readonly redis: RedisClient, private readonly prefix = 'cosmy:response:') {}

  async get(key: string): Promise<CachedValue | undefined> {
    const value = await this.redis.get(`${this.prefix}${key}`);
    if (!value) return undefined;
    try { return JSON.parse(value) as CachedValue; } catch { await this.delete(key); return undefined; }
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1_000).toISOString();
    await this.redis.set(`${this.prefix}${key}`, JSON.stringify({ value, expiresAt }), { EX: ttlSeconds });
  }

  async delete(key: string): Promise<void> { await this.redis.del(`${this.prefix}${key}`); }
}
