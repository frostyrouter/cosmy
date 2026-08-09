import { randomUUID } from 'node:crypto';
import type { ModelConfiguration, ResponseResult } from '../domain/types.js';
import type { RegistrySnapshot, UsageReservation } from '../ports/stores.js';
import type { IdempotencyClaim, IdempotencyStore, RegistryRepository, ReservationRepository } from './contracts.js';
import { RouterError } from '../domain/errors.js';

export interface SqlResult<Row> { rows: Row[]; }
export interface SqlClient {
  query<Row>(text: string, values?: readonly unknown[]): Promise<SqlResult<Row>>;
  transaction?<T>(work: (client: SqlClient) => Promise<T>): Promise<T>;
}

interface SnapshotRow { version: number; source: string; created_at: string; }
interface ManifestRow { model_id: string; manifest: ModelConfiguration; }
interface ReservationRow { reservation_id: string; tenant_id: string; estimated_cost_usd: string | number; }
interface UsageTotalsRow { reserved_usd: string | number; spent_usd: string | number; }
interface BudgetRow { tenant_id: string; limit_usd: string | number; reserved_usd: string | number; spent_usd: string | number; }
interface IdempotencyRow { request_hash: string; status: 'processing' | 'completed'; response_json: ResponseResult | null; }

function snapshot(row: SnapshotRow, models: readonly ModelConfiguration[]): RegistrySnapshot {
  return { version: Number(row.version), source: row.source, createdAt: new Date(row.created_at).toISOString(), models };
}

export class PostgresRegistryRepository implements RegistryRepository {
  constructor(private readonly db: SqlClient) {}

  async getCurrent(): Promise<RegistrySnapshot | undefined> {
    const current = await this.db.query<SnapshotRow>('SELECT version, source, created_at FROM model_registry_snapshots ORDER BY version DESC LIMIT 1');
    const row = current.rows[0];
    if (!row) return undefined;
    const manifests = await this.db.query<ManifestRow>('SELECT model_id, manifest FROM model_manifests WHERE snapshot_version = $1 ORDER BY model_id', [row.version]);
    return snapshot(row, manifests.rows.map((entry) => entry.manifest));
  }

  async publish(models: readonly ModelConfiguration[], source: string): Promise<RegistrySnapshot> {
    if (!this.db.transaction) throw new Error('PostgresRegistryRepository requires transactional SQL client');
    return this.db.transaction(async (tx) => {
      const inserted = await tx.query<SnapshotRow>('INSERT INTO model_registry_snapshots (source) VALUES ($1) RETURNING version, source, created_at', [source]);
      const row = inserted.rows[0];
      if (!row) throw new Error('Registry snapshot insert returned no row');
      for (const model of models) await tx.query('INSERT INTO model_manifests (snapshot_version, model_id, provider, model_name, manifest) VALUES ($1, $2, $3, $4, $5)', [row.version, model.id, model.provider, model.model, JSON.stringify(model)]);
      return snapshot(row, models);
    });
  }
}

export class PostgresReservationRepository implements ReservationRepository {
  constructor(private readonly db: SqlClient, private readonly defaultLimitUsd?: number, private readonly leaseSeconds = 300) {}

  async reserve(input: { tenantId: string; estimatedCostUsd: number }): Promise<UsageReservation> {
    if (!this.db.transaction) throw new Error('PostgresReservationRepository requires transactional SQL client');
    const id = randomUUID();
    return this.db.transaction(async (tx) => {
      if (this.defaultLimitUsd !== undefined) {
        await tx.query('INSERT INTO tenant_budgets (tenant_id, limit_usd) VALUES ($1, $2) ON CONFLICT (tenant_id) DO NOTHING', [input.tenantId, this.defaultLimitUsd]);
      }
      const existing = await tx.query<BudgetRow>('SELECT tenant_id, limit_usd, reserved_usd, spent_usd FROM tenant_budgets WHERE tenant_id = $1 FOR UPDATE', [input.tenantId]);
      const budget = existing.rows[0];
      if (budget) {
        const updated = await tx.query<BudgetRow>('UPDATE tenant_budgets SET reserved_usd = reserved_usd + $2, updated_at = now() WHERE tenant_id = $1 AND spent_usd + reserved_usd + $2 <= limit_usd RETURNING tenant_id, limit_usd, reserved_usd, spent_usd', [input.tenantId, input.estimatedCostUsd]);
        if (!updated.rows[0]) throw new RouterError('Tenant budget would be exceeded', 'budget_exceeded', 429, false);
      }
      const result = await tx.query<ReservationRow>("INSERT INTO usage_reservations (reservation_id, tenant_id, estimated_cost_usd, lease_expires_at) VALUES ($1, $2, $3, now() + ($4 * interval '1 second')) RETURNING reservation_id, tenant_id, estimated_cost_usd", [id, input.tenantId, input.estimatedCostUsd, this.leaseSeconds]);
      const row = result.rows[0];
      if (!row) throw new Error('Reservation insert returned no row');
      return { id: row.reservation_id, tenantId: row.tenant_id, estimatedCostUsd: Number(row.estimated_cost_usd) };
    });
  }

  async reconcile(reservation: UsageReservation, actualCostUsd: number): Promise<void> {
    await this.db.query(
      "WITH reconciled AS (UPDATE usage_reservations SET actual_cost_usd = $2, reconciled_at = now(), reconciliation_source = 'runtime' WHERE reservation_id = $1 AND reconciled_at IS NULL RETURNING tenant_id, estimated_cost_usd, actual_cost_usd) UPDATE tenant_budgets AS budgets SET reserved_usd = GREATEST(0, budgets.reserved_usd - reconciled.estimated_cost_usd), spent_usd = budgets.spent_usd + reconciled.actual_cost_usd, updated_at = now() FROM reconciled WHERE budgets.tenant_id = reconciled.tenant_id",
      [reservation.id, Math.max(0, actualCostUsd)],
    );
  }

  async heartbeat(reservation: UsageReservation): Promise<void> {
    await this.db.query("UPDATE usage_reservations SET lease_expires_at = now() + ($2 * interval '1 second') WHERE reservation_id = $1 AND reconciled_at IS NULL", [reservation.id, this.leaseSeconds]);
  }

  async reconcileExpired(limit = 100): Promise<number> {
    if (!this.db.transaction) throw new Error('PostgresReservationRepository requires transactional SQL client');
    return this.db.transaction(async (tx) => {
      const result = await tx.query<{ recovered_count: string | number }>(
        "WITH candidates AS (SELECT reservation_id FROM usage_reservations WHERE reconciled_at IS NULL AND lease_expires_at <= now() ORDER BY lease_expires_at FOR UPDATE SKIP LOCKED LIMIT $1), reconciled AS (UPDATE usage_reservations AS reservations SET actual_cost_usd = reservations.estimated_cost_usd, reconciled_at = now(), reconciliation_source = 'lease-expiry' FROM candidates WHERE reservations.reservation_id = candidates.reservation_id RETURNING reservations.tenant_id, reservations.estimated_cost_usd), totals AS (SELECT tenant_id, SUM(estimated_cost_usd) AS recovered_usd FROM reconciled GROUP BY tenant_id), budgets AS (UPDATE tenant_budgets SET reserved_usd = GREATEST(0, tenant_budgets.reserved_usd - totals.recovered_usd), spent_usd = tenant_budgets.spent_usd + totals.recovered_usd, updated_at = now() FROM totals WHERE tenant_budgets.tenant_id = totals.tenant_id RETURNING tenant_budgets.tenant_id) SELECT COUNT(*) AS recovered_count FROM reconciled",
        [limit],
      );
      return Number(result.rows[0]?.recovered_count ?? 0);
    });
  }

  async setBudget(tenantId: string, limitUsd: number): Promise<void> {
    if (!Number.isFinite(limitUsd) || limitUsd < 0) throw new Error('Budget limit must be a non-negative number');
    await this.db.query('INSERT INTO tenant_budgets (tenant_id, limit_usd) VALUES ($1, $2) ON CONFLICT (tenant_id) DO UPDATE SET limit_usd = EXCLUDED.limit_usd, updated_at = now()', [tenantId, limitUsd]);
  }

  async usageFor(tenantId: string): Promise<{ reservedUsd: number; spentUsd: number }> {
    const result = await this.db.query<UsageTotalsRow>('SELECT COALESCE(SUM(CASE WHEN reconciled_at IS NULL THEN estimated_cost_usd ELSE 0 END), 0) AS reserved_usd, COALESCE(SUM(CASE WHEN reconciled_at IS NOT NULL THEN actual_cost_usd ELSE 0 END), 0) AS spent_usd FROM usage_reservations WHERE tenant_id = $1', [tenantId]);
    const row = result.rows[0];
    return { reservedUsd: Number(row?.reserved_usd ?? 0), spentUsd: Number(row?.spent_usd ?? 0) };
  }
}

export class PostgresIdempotencyStore implements IdempotencyStore {
  private claims = 0;

  constructor(private readonly db: SqlClient) {}

  async claim(tenantId: string, key: string, requestHash: string, ttlSeconds: number): Promise<IdempotencyClaim> {
    this.claims += 1;
    if (this.claims % 256 === 0) {
      await this.db.query('DELETE FROM idempotency_records WHERE ctid IN (SELECT ctid FROM idempotency_records WHERE expires_at <= now() LIMIT 1000)');
    }
    await this.db.query('DELETE FROM idempotency_records WHERE tenant_id = $1 AND idempotency_key = $2 AND expires_at <= now()', [tenantId, key]);
    const inserted = await this.db.query<IdempotencyRow>(
      "INSERT INTO idempotency_records (tenant_id, idempotency_key, request_hash, status, expires_at) VALUES ($1, $2, $3, 'processing', now() + ($4 * interval '1 second')) ON CONFLICT (tenant_id, idempotency_key) DO NOTHING RETURNING request_hash, status, response_json",
      [tenantId, key, requestHash, ttlSeconds],
    );
    if (inserted.rows[0]) return { status: 'claimed' };
    const existing = await this.db.query<IdempotencyRow>('SELECT request_hash, status, response_json FROM idempotency_records WHERE tenant_id = $1 AND idempotency_key = $2', [tenantId, key]);
    const row = existing.rows[0];
    if (!row) return this.claim(tenantId, key, requestHash, ttlSeconds);
    if (row.request_hash !== requestHash) return { status: 'conflict' };
    if (row.status === 'completed' && row.response_json) return { status: 'replay', response: row.response_json };
    return { status: 'in-progress' };
  }

  async complete(tenantId: string, key: string, requestHash: string, response: ResponseResult): Promise<void> {
    const updated = await this.db.query<IdempotencyRow>("UPDATE idempotency_records SET status = 'completed', response_json = $4, updated_at = now() WHERE tenant_id = $1 AND idempotency_key = $2 AND request_hash = $3 AND status = 'processing' RETURNING request_hash, status, response_json", [tenantId, key, requestHash, JSON.stringify(response)]);
    if (!updated.rows[0]) throw new Error('Idempotency claim was not available for completion');
  }

  async release(tenantId: string, key: string, requestHash: string): Promise<void> {
    await this.db.query("DELETE FROM idempotency_records WHERE tenant_id = $1 AND idempotency_key = $2 AND request_hash = $3 AND status = 'processing'", [tenantId, key, requestHash]);
  }
}
