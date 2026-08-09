import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
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

interface MigrationRow { checksum: string; }

export async function applyControlPlaneMigrations(client: SqlClient, migrationDirectory = 'migrations'): Promise<void> {
  if (!client.transaction) throw new Error('Managed migrations require a transactional SQL client');
  const files = (await readdir(migrationDirectory)).filter((file) => /^\d+.*\.sql$/u.test(file)).sort();
  await client.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['cosmy:schema-migrations']);
    await tx.query('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    for (const version of files) {
      const sql = await readFile(join(migrationDirectory, version), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const existing = await tx.query<MigrationRow>('SELECT checksum FROM schema_migrations WHERE version = $1', [version]);
      const applied = existing.rows[0];
      if (applied) {
        if (applied.checksum !== checksum) throw new Error(`Applied migration '${version}' checksum does not match the repository`);
        continue;
      }
      await tx.query(sql);
      await tx.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [version, checksum]);
    }
  });
}

export async function applyControlPlaneMigration(client: SqlClient, migrationPath?: string): Promise<void> {
  if (migrationPath) {
    await client.query(await readFile(migrationPath, 'utf8'));
    return;
  }
  await applyControlPlaneMigrations(client);
}
