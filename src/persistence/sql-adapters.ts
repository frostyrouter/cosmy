import { randomUUID } from 'node:crypto';
import type { ModelConfiguration } from '../domain/types.js';
import type { RegistrySnapshot, UsageReservation } from '../ports/stores.js';
import type { RegistryRepository, ReservationRepository } from './contracts.js';
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
  constructor(private readonly db: SqlClient, private readonly defaultLimitUsd?: number) {}

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
      const result = await tx.query<ReservationRow>('INSERT INTO usage_reservations (reservation_id, tenant_id, estimated_cost_usd) VALUES ($1, $2, $3) RETURNING reservation_id, tenant_id, estimated_cost_usd', [id, input.tenantId, input.estimatedCostUsd]);
      const row = result.rows[0];
      if (!row) throw new Error('Reservation insert returned no row');
      return { id: row.reservation_id, tenantId: row.tenant_id, estimatedCostUsd: Number(row.estimated_cost_usd) };
    });
  }

  async reconcile(reservation: UsageReservation, actualCostUsd: number): Promise<void> {
    await this.db.query(
      'WITH reconciled AS (UPDATE usage_reservations SET actual_cost_usd = $2, reconciled_at = now() WHERE reservation_id = $1 AND reconciled_at IS NULL RETURNING tenant_id, estimated_cost_usd, actual_cost_usd) UPDATE tenant_budgets AS budgets SET reserved_usd = GREATEST(0, budgets.reserved_usd - reconciled.estimated_cost_usd), spent_usd = budgets.spent_usd + reconciled.actual_cost_usd, updated_at = now() FROM reconciled WHERE budgets.tenant_id = reconciled.tenant_id',
      [reservation.id, Math.max(0, actualCostUsd)],
    );
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
