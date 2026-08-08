import { readFile } from 'node:fs/promises';
import { Pool, type PoolClient } from 'pg';
import type { SqlClient, SqlResult } from './sql-adapters.js';

export class PostgresSqlClient implements SqlClient {
  constructor(private readonly pool: Pool) {}

  async query<Row>(text: string, values: readonly unknown[] = []): Promise<SqlResult<Row>> {
    const result = await this.pool.query(text, [...values]);
    return { rows: result.rows as Row[] };
  }

  async transaction<T>(work: (client: SqlClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(new TransactionClient(client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> { await this.pool.end(); }
}

class TransactionClient implements SqlClient {
  constructor(private readonly client: PoolClient) {}

  async query<Row>(text: string, values: readonly unknown[] = []): Promise<SqlResult<Row>> {
    const result = await this.client.query(text, [...values]);
    return { rows: result.rows as Row[] };
  }
}

export async function createPostgresSqlClient(connectionString: string): Promise<PostgresSqlClient> {
  const pool = new Pool({ connectionString, max: 20, idleTimeoutMillis: 30_000 });
  const client = await pool.connect();
  client.release();
  return new PostgresSqlClient(pool);
}

export async function applyControlPlaneMigration(client: SqlClient, migrationPath = 'migrations/001_control_plane.sql'): Promise<void> {
  await client.query(await readFile(migrationPath, 'utf8'));
}
