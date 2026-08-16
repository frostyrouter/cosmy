import { describe, expect, it } from 'vitest';
import { applyControlPlaneMigrations } from '../src/persistence/postgres.js';
import type { SqlClient } from '../src/persistence/sql-adapters.js';

describe('managed database migrations', () => {
  it('applies every pending migration under one transactional advisory lock', async () => {
    const queries: string[] = [];
    const db: SqlClient = {
      query: async <Row>(text: string) => {
        queries.push(text);
        return { rows: [] as Row[] };
      },
      transaction: async (work) => work(db),
    };
    await applyControlPlaneMigrations(db);
    expect(queries[0]).toContain('pg_advisory_xact_lock');
    expect(queries.some((query) => query.includes('CREATE TABLE IF NOT EXISTS usage_reservations'))).toBe(true);
    expect(queries.some((query) => query.includes('CREATE TABLE IF NOT EXISTS tenant_budgets'))).toBe(true);
    expect(queries.some((query) => query.includes('CREATE TABLE IF NOT EXISTS idempotency_records'))).toBe(true);
    expect(queries.some((query) => query.includes('lease_expires_at'))).toBe(true);
    expect(queries.some((query) => query.includes('CREATE TABLE IF NOT EXISTS admin_audit_events'))).toBe(true);
    expect(queries.some((query) => query.includes('CREATE TABLE IF NOT EXISTS model_promotion_evidence'))).toBe(true);
    expect(queries.some((query) => query.includes('CREATE TABLE IF NOT EXISTS model_rollouts'))).toBe(true);
    expect(queries.some((query) => query.includes('CREATE TABLE IF NOT EXISTS shadow_campaigns'))).toBe(true);
    expect(queries.some((query) => query.includes('CREATE TABLE IF NOT EXISTS route_decisions'))).toBe(true);
    expect(queries.some((query) => query.includes('CREATE TABLE IF NOT EXISTS provider_health_state'))).toBe(true);
    expect(queries.some((query) => query.includes("state IN ('planned', 'completed', 'failed', 'cancelled', 'rejected')"))).toBe(true);
    expect(queries.some((query) => query.includes("ADD COLUMN IF NOT EXISTS attempts JSONB"))).toBe(true);
    expect(queries.some((query) => query.includes('CREATE TABLE IF NOT EXISTS api_credentials'))).toBe(true);
    expect(queries.filter((query) => query.startsWith('INSERT INTO schema_migrations'))).toHaveLength(12);
  });
});
