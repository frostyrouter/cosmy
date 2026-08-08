import { randomUUID } from 'node:crypto';
import type { ModelConfiguration } from '../domain/types.js';
import type { RegistrySnapshot, UsageReservation } from '../ports/stores.js';
import type { RegistryRepository, ReservationRepository } from './contracts.js';

export interface SqlResult<Row> { rows: Row[]; }
export interface SqlClient {
  query<Row>(text: string, values?: readonly unknown[]): Promise<SqlResult<Row>>;
  transaction?<T>(work: (client: SqlClient) => Promise<T>): Promise<T>;
}

interface SnapshotRow { version: number; source: string; created_at: string; }
interface ManifestRow { model_id: string; manifest: ModelConfiguration; }
interface ReservationRow { reservation_id: string; tenant_id: string; estimated_cost_usd: string | number; }
interface UsageTotalsRow { reserved_usd: string | number; spent_usd: string | number; }

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
  constructor(private readonly db: SqlClient) {}

  async reserve(input: { tenantId: string; estimatedCostUsd: number }): Promise<UsageReservation> {
    const id = randomUUID();
    const result = await this.db.query<ReservationRow>('INSERT INTO usage_reservations (reservation_id, tenant_id, estimated_cost_usd) VALUES ($1, $2, $3) RETURNING reservation_id, tenant_id, estimated_cost_usd', [id, input.tenantId, input.estimatedCostUsd]);
    const row = result.rows[0];
    if (!row) throw new Error('Reservation insert returned no row');
    return { id: row.reservation_id, tenantId: row.tenant_id, estimatedCostUsd: Number(row.estimated_cost_usd) };
  }

  async reconcile(reservation: UsageReservation, actualCostUsd: number): Promise<void> {
    await this.db.query('UPDATE usage_reservations SET actual_cost_usd = $2, reconciled_at = now() WHERE reservation_id = $1 AND reconciled_at IS NULL', [reservation.id, Math.max(0, actualCostUsd)]);
  }

  async usageFor(tenantId: string): Promise<{ reservedUsd: number; spentUsd: number }> {
    const result = await this.db.query<UsageTotalsRow>('SELECT COALESCE(SUM(CASE WHEN reconciled_at IS NULL THEN estimated_cost_usd ELSE 0 END), 0) AS reserved_usd, COALESCE(SUM(CASE WHEN reconciled_at IS NOT NULL THEN actual_cost_usd ELSE 0 END), 0) AS spent_usd FROM usage_reservations WHERE tenant_id = $1', [tenantId]);
    const row = result.rows[0];
    return { reservedUsd: Number(row?.reserved_usd ?? 0), spentUsd: Number(row?.spent_usd ?? 0) };
  }
}
