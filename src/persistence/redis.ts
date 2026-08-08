import { createClient, type RedisClientType } from 'redis';
import type { RedisClient } from './redis-adapter.js';

export class RedisConnection implements RedisClient {
  constructor(private readonly client: RedisClientType) {}

  async get(key: string): Promise<string | null> { return this.client.get(key); }

  async set(key: string, value: string, options?: { EX?: number }): Promise<unknown> {
    return this.client.set(key, value, options?.EX ? { EX: options.EX } : undefined);
  }

  async del(key: string): Promise<number> { return this.client.del(key); }

  async close(): Promise<void> { await this.client.quit(); }
}

export async function createRedisConnection(url: string): Promise<RedisConnection> {
  const client = createClient({ url });
  await client.connect();
  return new RedisConnection(client);
}
