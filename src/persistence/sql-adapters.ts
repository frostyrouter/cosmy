import { randomUUID } from 'node:crypto';
import type { DecisionRecord, ModelConfiguration, ResponseResult } from '../domain/types.js';
import type { BudgetSnapshot, RegistrySnapshot, UsageReservation } from '../ports/stores.js';
import type { AuditEvent, ControlPlaneStore, DecisionStore, IdempotencyClaim, IdempotencyStore, RegistryRepository, ReservationRepository } from './contracts.js';
import { RouterError } from '../domain/errors.js';
import { assessPromotion, hasModelVersionConflict, needsPromotionEvidence, type ModelPromotionEvidence } from '../control-plane/promotion.js';
import type { ModelRollout, RolloutOutcome } from '../rollouts/rollout.js';
import type { ShadowCampaign, ShadowObservation, ShadowReservation } from '../shadow/shadow.js';

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
interface AuditRow { id: string; actor_credential_id: string; actor_tenant_id: string; action: AuditEvent['action']; target: string; details: Record<string, unknown>; occurred_at: string; }
interface EvidenceRow { id: string; model_id: string; model_version: string; suite_version: string; dataset_version: string; conformance_passed: boolean; pricing_verified: boolean; usage_verified: boolean; routing_pass_rate: number; quality_score: number; sample_count: number; evaluated_at: string; expires_at: string; submitted_by_credential_id: string; submitted_at: string; }
interface RolloutRow { id: string; model_id: string; model_version: string; state: ModelRollout['state']; traffic_percentage: number; minimum_samples: number; maximum_error_rate: number; maximum_average_latency_ms: number; sample_count: string | number; error_count: string | number; total_latency_ms: number; reason: string | null; created_at: string; updated_at: string; }
interface ShadowCampaignRow { id: string; model_id: string; model_version: string; state: ShadowCampaign['state']; sample_percentage: number; budget_limit_usd: string | number; reserved_usd: string | number; spent_usd: string | number; allowed_data_classes: ShadowCampaign['allowedDataClasses']; sample_count: string | number; success_count: string | number; error_count: string | number; created_at: string; updated_at: string; }
interface DecisionRow { decision_id: string; tenant_id: string; state: DecisionRecord['state']; route: DecisionRecord['route'] | null; registry_version: string | number | null; outcome: DecisionRecord['outcome'] | null; rejection: DecisionRecord['rejection'] | null; attempts: DecisionRecord['attempts'] | null; error_code: string | null; created_at: string; updated_at: string; }

const rolloutContentionAttempts = 6;

function retryableRolloutContention(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  return code === '55P03' || code === '57014';
}

function rolloutBackoff(attempt: number): Promise<void> {
  const delayMs = Math.min(40, 5 * (2 ** attempt)) + Math.floor(Math.random() * 6);
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function snapshot(row: SnapshotRow, models: readonly ModelConfiguration[]): RegistrySnapshot {
  return { version: Number(row.version), source: row.source, createdAt: new Date(row.created_at).toISOString(), models };
}

function decisionRecord(row: DecisionRow): DecisionRecord {
  return {
    id: row.decision_id, tenantId: row.tenant_id, state: row.state, ...(row.route ? { route: row.route } : {}), attempts: row.attempts ?? [],
    ...(row.registry_version === null ? {} : { registryVersion: Number(row.registry_version) }),
    ...(row.outcome ? { outcome: row.outcome } : {}), ...(row.rejection ? { rejection: row.rejection } : {}), ...(row.error_code ? { errorCode: row.error_code } : {}),
    createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
  };
}

const decisionColumns = 'decision_id, tenant_id, state, route, registry_version, outcome, rejection, attempts, error_code, created_at, updated_at';

export class PostgresDecisionStore implements DecisionStore {
  constructor(private readonly db: SqlClient) {}

  async save(record: DecisionRecord): Promise<void> {
    await this.db.query(`INSERT INTO route_decisions (decision_id, tenant_id, state, route, registry_version, outcome, rejection, attempts, error_code, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT (tenant_id, decision_id) DO UPDATE SET state = EXCLUDED.state, route = EXCLUDED.route, registry_version = EXCLUDED.registry_version, outcome = EXCLUDED.outcome, rejection = EXCLUDED.rejection, attempts = EXCLUDED.attempts, error_code = EXCLUDED.error_code, updated_at = EXCLUDED.updated_at`, [record.id, record.tenantId, record.state, record.route ? JSON.stringify(record.route) : null, record.registryVersion ?? null, record.outcome ? JSON.stringify(record.outcome) : null, record.rejection ? JSON.stringify(record.rejection) : null, JSON.stringify(record.attempts), record.errorCode ?? null, record.createdAt, record.updatedAt]);
  }

  async get(tenantId: string, decisionId: string): Promise<DecisionRecord | undefined> {
    const result = await this.db.query<DecisionRow>(`SELECT ${decisionColumns} FROM route_decisions WHERE tenant_id = $1 AND decision_id = $2`, [tenantId, decisionId]);
    return result.rows[0] ? decisionRecord(result.rows[0]) : undefined;
  }
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
      await tx.query("SELECT pg_advisory_xact_lock(hashtext('cosmy:registry-publish'))");
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
      await tx.query("SELECT pg_advisory_xact_lock(hashtext('cosmy:tenant-budget:' || $1))", [input.tenantId]);
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
    if (!this.db.transaction) throw new Error('PostgresReservationRepository requires transactional SQL client');
    await this.db.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext('cosmy:tenant-budget:' || $1))", [tenantId]);
      await tx.query('SELECT reservation_id FROM usage_reservations WHERE tenant_id = $1 FOR UPDATE', [tenantId]);
      const usage = await tx.query<UsageTotalsRow>('SELECT COALESCE(SUM(CASE WHEN reconciled_at IS NULL THEN estimated_cost_usd ELSE 0 END), 0) AS reserved_usd, COALESCE(SUM(CASE WHEN reconciled_at IS NOT NULL THEN actual_cost_usd ELSE 0 END), 0) AS spent_usd FROM usage_reservations WHERE tenant_id = $1', [tenantId]);
      const reservedUsd = Number(usage.rows[0]?.reserved_usd ?? 0);
      const spentUsd = Number(usage.rows[0]?.spent_usd ?? 0);
      if (limitUsd < reservedUsd + spentUsd) throw new RouterError('Budget limit cannot be lower than current usage', 'budget_below_usage', 409, false);
      await tx.query('INSERT INTO tenant_budgets (tenant_id, limit_usd, reserved_usd, spent_usd) VALUES ($1, $2, $3, $4) ON CONFLICT (tenant_id) DO UPDATE SET limit_usd = EXCLUDED.limit_usd, reserved_usd = EXCLUDED.reserved_usd, spent_usd = EXCLUDED.spent_usd, updated_at = now()', [tenantId, limitUsd, reservedUsd, spentUsd]);
    });
  }

  async usageFor(tenantId: string): Promise<{ reservedUsd: number; spentUsd: number }> {
    const result = await this.db.query<UsageTotalsRow>('SELECT COALESCE(SUM(CASE WHEN reconciled_at IS NULL THEN estimated_cost_usd ELSE 0 END), 0) AS reserved_usd, COALESCE(SUM(CASE WHEN reconciled_at IS NOT NULL THEN actual_cost_usd ELSE 0 END), 0) AS spent_usd FROM usage_reservations WHERE tenant_id = $1', [tenantId]);
    const row = result.rows[0];
    return { reservedUsd: Number(row?.reserved_usd ?? 0), spentUsd: Number(row?.spent_usd ?? 0) };
  }
}

function budgetSnapshot(tenantId: string, row: BudgetRow | undefined): BudgetSnapshot {
  return {
    tenantId,
    ...(row ? { limitUsd: Number(row.limit_usd) } : {}),
    reservedUsd: Number(row?.reserved_usd ?? 0),
    spentUsd: Number(row?.spent_usd ?? 0),
  };
}

function auditEvent(row: AuditRow): AuditEvent {
  return {
    id: row.id,
    actorCredentialId: row.actor_credential_id,
    actorTenantId: row.actor_tenant_id,
    action: row.action,
    target: row.target,
    details: row.details,
    occurredAt: new Date(row.occurred_at).toISOString(),
  };
}

function promotionEvidence(row: EvidenceRow): ModelPromotionEvidence {
  return {
    id: row.id, modelId: row.model_id, modelVersion: row.model_version, suiteVersion: row.suite_version, datasetVersion: row.dataset_version,
    conformancePassed: row.conformance_passed, pricingVerified: row.pricing_verified, usageVerified: row.usage_verified,
    routingPassRate: Number(row.routing_pass_rate), qualityScore: Number(row.quality_score), sampleCount: Number(row.sample_count),
    evaluatedAt: new Date(row.evaluated_at).toISOString(), expiresAt: new Date(row.expires_at).toISOString(),
    submittedByCredentialId: row.submitted_by_credential_id, submittedAt: new Date(row.submitted_at).toISOString(),
  };
}

function modelRollout(row: RolloutRow): ModelRollout {
  return {
    id: row.id, modelId: row.model_id, modelVersion: row.model_version, state: row.state,
    trafficPercentage: Number(row.traffic_percentage), minimumSamples: Number(row.minimum_samples), maximumErrorRate: Number(row.maximum_error_rate), maximumAverageLatencyMs: Number(row.maximum_average_latency_ms),
    sampleCount: Number(row.sample_count), errorCount: Number(row.error_count), totalLatencyMs: Number(row.total_latency_ms),
    ...(row.reason ? { reason: row.reason } : {}), createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
  };
}

const rolloutColumns = 'id, model_id, model_version, state, traffic_percentage, minimum_samples, maximum_error_rate, maximum_average_latency_ms, sample_count, error_count, total_latency_ms, reason, created_at, updated_at';
const shadowCampaignColumns = 'id, model_id, model_version, state, sample_percentage, budget_limit_usd, reserved_usd, spent_usd, allowed_data_classes, sample_count, success_count, error_count, created_at, updated_at';

function shadowCampaign(row: ShadowCampaignRow): ShadowCampaign {
  return { id: row.id, modelId: row.model_id, modelVersion: row.model_version, state: row.state, samplePercentage: Number(row.sample_percentage), budgetLimitUsd: Number(row.budget_limit_usd), reservedUsd: Number(row.reserved_usd), spentUsd: Number(row.spent_usd), allowedDataClasses: row.allowed_data_classes, sampleCount: Number(row.sample_count), successCount: Number(row.success_count), errorCount: Number(row.error_count), createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() };
}

export class PostgresControlPlaneStore implements ControlPlaneStore {
  constructor(private readonly db: SqlClient, private readonly rolloutDb: SqlClient = db, private readonly shadowDb: SqlClient = rolloutDb) {}

  async publishModels(input: { models: readonly ModelConfiguration[]; source: string; actorCredentialId: string; actorTenantId: string }): Promise<RegistrySnapshot> {
    if (!this.db.transaction) throw new Error('PostgresControlPlaneStore requires transactional SQL client');
    return this.db.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext('cosmy:registry-publish'))");
      const current = await tx.query<ManifestRow>('SELECT model_id, manifest FROM model_manifests WHERE snapshot_version = (SELECT MAX(version) FROM model_registry_snapshots)');
      const currentById = new Map(current.rows.map((entry) => [entry.model_id, entry.manifest]));
      for (const model of input.models) {
        const currentModel = currentById.get(model.id);
        if (hasModelVersionConflict(currentModel, model)) throw new RouterError(`Model '${model.id}' version '${model.version}' is immutable; publish material changes under a new version`, 'model_version_conflict', 409, false);
        if (!needsPromotionEvidence(currentModel, model)) continue;
        const evidence = await this.evidenceForWith(tx, model.id, model.version);
        const reasons = assessPromotion(model, evidence);
        if (reasons.length) throw new RouterError(`Model '${model.id}' failed promotion gates: ${reasons.join(', ')}`, 'promotion_gate_failed', 409, false);
      }
      const inserted = await tx.query<SnapshotRow>('INSERT INTO model_registry_snapshots (source) VALUES ($1) RETURNING version, source, created_at', [input.source]);
      const row = inserted.rows[0];
      if (!row) throw new Error('Registry snapshot insert returned no row');
      for (const model of input.models) await tx.query('INSERT INTO model_manifests (snapshot_version, model_id, provider, model_name, manifest) VALUES ($1, $2, $3, $4, $5)', [row.version, model.id, model.provider, model.model, JSON.stringify(model)]);
      await this.appendAudit(tx, input.actorCredentialId, input.actorTenantId, 'models.publish', `registry:${row.version}`, { source: input.source, modelCount: input.models.length });
      return snapshot(row, input.models);
    });
  }

  async budgetFor(tenantId: string): Promise<BudgetSnapshot> {
    const result = await this.db.query<BudgetRow>('SELECT tenant_id, limit_usd, reserved_usd, spent_usd FROM tenant_budgets WHERE tenant_id = $1', [tenantId]);
    const row = result.rows[0];
    if (row) return budgetSnapshot(tenantId, row);
    const usage = await this.db.query<UsageTotalsRow>('SELECT COALESCE(SUM(CASE WHEN reconciled_at IS NULL THEN estimated_cost_usd ELSE 0 END), 0) AS reserved_usd, COALESCE(SUM(CASE WHEN reconciled_at IS NOT NULL THEN actual_cost_usd ELSE 0 END), 0) AS spent_usd FROM usage_reservations WHERE tenant_id = $1', [tenantId]);
    const totals = usage.rows[0];
    return { tenantId, reservedUsd: Number(totals?.reserved_usd ?? 0), spentUsd: Number(totals?.spent_usd ?? 0) };
  }

  async setBudget(input: { tenantId: string; limitUsd: number; actorCredentialId: string; actorTenantId: string }): Promise<BudgetSnapshot> {
    if (!this.db.transaction) throw new Error('PostgresControlPlaneStore requires transactional SQL client');
    return this.db.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext('cosmy:tenant-budget:' || $1))", [input.tenantId]);
      await tx.query('SELECT reservation_id FROM usage_reservations WHERE tenant_id = $1 FOR UPDATE', [input.tenantId]);
      const usage = await tx.query<UsageTotalsRow>('SELECT COALESCE(SUM(CASE WHEN reconciled_at IS NULL THEN estimated_cost_usd ELSE 0 END), 0) AS reserved_usd, COALESCE(SUM(CASE WHEN reconciled_at IS NOT NULL THEN actual_cost_usd ELSE 0 END), 0) AS spent_usd FROM usage_reservations WHERE tenant_id = $1', [input.tenantId]);
      const reservedUsd = Number(usage.rows[0]?.reserved_usd ?? 0);
      const spentUsd = Number(usage.rows[0]?.spent_usd ?? 0);
      if (input.limitUsd < reservedUsd + spentUsd) throw new RouterError('Budget limit cannot be lower than current usage', 'budget_below_usage', 409, false);
      const result = await tx.query<BudgetRow>('INSERT INTO tenant_budgets (tenant_id, limit_usd, reserved_usd, spent_usd) VALUES ($1, $2, $3, $4) ON CONFLICT (tenant_id) DO UPDATE SET limit_usd = EXCLUDED.limit_usd, reserved_usd = EXCLUDED.reserved_usd, spent_usd = EXCLUDED.spent_usd, updated_at = now() RETURNING tenant_id, limit_usd, reserved_usd, spent_usd', [input.tenantId, input.limitUsd, reservedUsd, spentUsd]);
      const row = result.rows[0];
      if (!row) throw new Error('Budget update returned no row');
      await this.appendAudit(tx, input.actorCredentialId, input.actorTenantId, 'budget.set', `tenant:${input.tenantId}`, { limitUsd: input.limitUsd });
      return budgetSnapshot(input.tenantId, row);
    });
  }

  async listAudit(limit: number): Promise<readonly AuditEvent[]> {
    const result = await this.db.query<AuditRow>('SELECT id, actor_credential_id, actor_tenant_id, action, target, details, occurred_at FROM admin_audit_events ORDER BY occurred_at DESC, id DESC LIMIT $1', [limit]);
    return result.rows.map(auditEvent);
  }

  async submitEvidence(input: Omit<ModelPromotionEvidence, 'id' | 'submittedAt' | 'submittedByCredentialId'> & { actorCredentialId: string; actorTenantId: string }): Promise<ModelPromotionEvidence> {
    if (!this.db.transaction) throw new Error('PostgresControlPlaneStore requires transactional SQL client');
    return this.db.transaction(async (tx) => {
      const id = randomUUID();
      const result = await tx.query<EvidenceRow>('INSERT INTO model_promotion_evidence (id, model_id, model_version, suite_version, dataset_version, conformance_passed, pricing_verified, usage_verified, routing_pass_rate, quality_score, sample_count, evaluated_at, expires_at, submitted_by_credential_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id, model_id, model_version, suite_version, dataset_version, conformance_passed, pricing_verified, usage_verified, routing_pass_rate, quality_score, sample_count, evaluated_at, expires_at, submitted_by_credential_id, submitted_at', [id, input.modelId, input.modelVersion, input.suiteVersion, input.datasetVersion, input.conformancePassed, input.pricingVerified, input.usageVerified, input.routingPassRate, input.qualityScore, input.sampleCount, input.evaluatedAt, input.expiresAt, input.actorCredentialId]);
      const row = result.rows[0];
      if (!row) throw new Error('Evidence insert returned no row');
      await this.appendAudit(tx, input.actorCredentialId, input.actorTenantId, 'model_evidence.submit', `model:${input.modelId}@${input.modelVersion}`, { suiteVersion: input.suiteVersion, datasetVersion: input.datasetVersion, sampleCount: input.sampleCount });
      return promotionEvidence(row);
    });
  }

  evidenceFor(modelId: string, modelVersion: string): Promise<ModelPromotionEvidence | undefined> { return this.evidenceForWith(this.db, modelId, modelVersion); }

  async createRollout(input: Omit<ModelRollout, 'id' | 'state' | 'sampleCount' | 'errorCount' | 'totalLatencyMs' | 'reason' | 'createdAt' | 'updatedAt'> & { actorCredentialId: string; actorTenantId: string }): Promise<ModelRollout> {
    if (!this.db.transaction) throw new Error('PostgresControlPlaneStore requires transactional SQL client');
    return this.db.transaction(async (tx) => {
      const id = randomUUID();
      let result: SqlResult<RolloutRow>;
      try {
        result = await tx.query<RolloutRow>(`INSERT INTO model_rollouts (id, model_id, model_version, state, traffic_percentage, minimum_samples, maximum_error_rate, maximum_average_latency_ms) VALUES ($1, $2, $3, 'canary', $4, $5, $6, $7) RETURNING ${rolloutColumns}`, [id, input.modelId, input.modelVersion, input.trafficPercentage, input.minimumSamples, input.maximumErrorRate, input.maximumAverageLatencyMs]);
      } catch (error) {
        if ((error as { code?: string }).code === '23505') throw new RouterError('A canary already exists for this model', 'rollout_conflict', 409, false);
        throw error;
      }
      const row = result.rows[0]; if (!row) throw new Error('Rollout insert returned no row');
      await this.appendAudit(tx, input.actorCredentialId, input.actorTenantId, 'rollout.start', `rollout:${id}`, { modelId: input.modelId, modelVersion: input.modelVersion, trafficPercentage: input.trafficPercentage });
      return modelRollout(row);
    });
  }

  async rollout(id: string): Promise<ModelRollout | undefined> {
    const result = await this.db.query<RolloutRow>(`SELECT ${rolloutColumns} FROM model_rollouts WHERE id = $1`, [id]);
    return result.rows[0] ? modelRollout(result.rows[0]) : undefined;
  }

  async runtimeRollouts(): Promise<readonly ModelRollout[]> {
    const result = await this.db.query<RolloutRow>(`SELECT DISTINCT ON (model_id) ${rolloutColumns} FROM model_rollouts ORDER BY model_id, created_at DESC, id DESC`);
    return result.rows.map(modelRollout);
  }

  async changeRollout(input: { id: string; action: 'promote' | 'rollback'; reason?: string; actorCredentialId: string; actorTenantId: string }): Promise<ModelRollout> {
    if (!this.db.transaction) throw new Error('PostgresControlPlaneStore requires transactional SQL client');
    return this.db.transaction(async (tx) => {
      const current = await tx.query<RolloutRow>(`SELECT ${rolloutColumns} FROM model_rollouts WHERE id = $1 AND state = 'canary' FOR UPDATE`, [input.id]);
      const currentRow = current.rows[0];
      if (!currentRow) throw new RouterError('Canary rollout was not found or is no longer mutable', 'rollout_not_mutable', 409, false);
      const currentRollout = modelRollout(currentRow);
      if (input.action === 'promote' && (currentRollout.sampleCount < currentRollout.minimumSamples || currentRollout.errorCount / currentRollout.sampleCount > currentRollout.maximumErrorRate || currentRollout.totalLatencyMs / currentRollout.sampleCount > currentRollout.maximumAverageLatencyMs)) throw new RouterError('Canary has not met its minimum sample and health thresholds', 'rollout_not_ready', 409, false);
      const state = input.action === 'promote' ? 'active' : 'rolled_back';
      const result = await tx.query<RolloutRow>(`UPDATE model_rollouts SET state = $2, reason = $3, updated_at = now() WHERE id = $1 AND state = 'canary' RETURNING ${rolloutColumns}`, [input.id, state, input.reason ?? null]);
      const row = result.rows[0];
      if (!row) throw new RouterError('Canary rollout changed concurrently', 'rollout_not_mutable', 409, false);
      await this.appendAudit(tx, input.actorCredentialId, input.actorTenantId, `rollout.${input.action}`, `rollout:${input.id}`, { reason: input.reason ?? null });
      return modelRollout(row);
    });
  }

  async recordRolloutOutcome(outcome: RolloutOutcome): Promise<ModelRollout | undefined> {
    if (outcome.status === 'cancelled') {
      const current = await this.rolloutDb.query<RolloutRow>(`SELECT ${rolloutColumns} FROM model_rollouts WHERE model_id = $1 AND model_version = $2 AND state = 'canary' ORDER BY created_at DESC LIMIT 1`, [outcome.modelId, outcome.modelVersion]);
      return current.rows[0] ? modelRollout(current.rows[0]) : undefined;
    }
    if (!this.rolloutDb.transaction) throw new Error('PostgresControlPlaneStore rollout observations require transactional SQL client');
    let lastContention: unknown;
    for (let attempt = 0; attempt < rolloutContentionAttempts; attempt += 1) {
      try {
        return await this.rolloutDb.transaction(async (tx) => {
          await tx.query("SET LOCAL statement_timeout = '100ms'");
          await tx.query("SET LOCAL lock_timeout = '75ms'");
          const failed = outcome.status === 'error' ? 1 : 0;
          const result = await tx.query<RolloutRow>(`UPDATE model_rollouts SET sample_count = sample_count + 1, error_count = error_count + $3, total_latency_ms = total_latency_ms + $4, state = CASE WHEN sample_count + 1 >= minimum_samples AND (((error_count + $3)::double precision / (sample_count + 1)) > maximum_error_rate OR ((total_latency_ms + $4) / (sample_count + 1)) > maximum_average_latency_ms) THEN 'rolled_back' ELSE state END, reason = CASE WHEN sample_count + 1 >= minimum_samples AND ((error_count + $3)::double precision / (sample_count + 1)) > maximum_error_rate THEN 'error_rate_exceeded' WHEN sample_count + 1 >= minimum_samples AND ((total_latency_ms + $4) / (sample_count + 1)) > maximum_average_latency_ms THEN 'average_latency_exceeded' ELSE reason END, updated_at = now() WHERE model_id = $1 AND model_version = $2 AND state = 'canary' RETURNING ${rolloutColumns}`, [outcome.modelId, outcome.modelVersion, failed, Math.max(0, outcome.latencyMs)]);
          const row = result.rows[0]; if (!row) return undefined;
          const rollout = modelRollout(row);
          if (rollout.state === 'rolled_back') await this.appendAudit(tx, 'system', 'platform', 'rollout.auto_rollback', `rollout:${rollout.id}`, { reason: rollout.reason, sampleCount: rollout.sampleCount, errorRate: rollout.errorCount / rollout.sampleCount, averageLatencyMs: rollout.totalLatencyMs / rollout.sampleCount });
          return rollout;
        });
      } catch (error) {
        if (!retryableRolloutContention(error) || attempt === rolloutContentionAttempts - 1) throw error;
        lastContention = error;
        await rolloutBackoff(attempt);
      }
    }
    throw lastContention;
  }

  async createShadowCampaign(input: Omit<ShadowCampaign, 'id' | 'state' | 'reservedUsd' | 'spentUsd' | 'sampleCount' | 'successCount' | 'errorCount' | 'createdAt' | 'updatedAt'> & { actorCredentialId: string; actorTenantId: string }): Promise<ShadowCampaign> {
    if (!this.db.transaction) throw new Error('PostgresControlPlaneStore requires transactional SQL client');
    return this.db.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext('cosmy:shadow-campaigns'))");
      const active = await tx.query<{ count: string | number }>("SELECT COUNT(*) AS count FROM shadow_campaigns WHERE state = 'active'");
      if (Number(active.rows[0]?.count ?? 0) >= 64) throw new RouterError('The active shadow campaign limit has been reached', 'shadow_campaign_limit', 409, false);
      const id = randomUUID(); let result: SqlResult<ShadowCampaignRow>;
      try { result = await tx.query<ShadowCampaignRow>(`INSERT INTO shadow_campaigns (id, model_id, model_version, state, sample_percentage, budget_limit_usd, allowed_data_classes) VALUES ($1, $2, $3, 'active', $4, $5, $6) RETURNING ${shadowCampaignColumns}`, [id, input.modelId, input.modelVersion, input.samplePercentage, input.budgetLimitUsd, JSON.stringify(input.allowedDataClasses)]); }
      catch (error) { if ((error as { code?: string }).code === '23505') throw new RouterError('An active shadow campaign already exists for this model', 'shadow_campaign_conflict', 409, false); throw error; }
      const row = result.rows[0]; if (!row) throw new Error('Shadow campaign insert returned no row');
      await this.appendAudit(tx, input.actorCredentialId, input.actorTenantId, 'shadow.start', `shadow:${id}`, { modelId: input.modelId, modelVersion: input.modelVersion, samplePercentage: input.samplePercentage, budgetLimitUsd: input.budgetLimitUsd }); return shadowCampaign(row);
    });
  }

  async shadowCampaign(id: string): Promise<ShadowCampaign | undefined> { const result = await this.db.query<ShadowCampaignRow>(`SELECT ${shadowCampaignColumns} FROM shadow_campaigns WHERE id = $1`, [id]); return result.rows[0] ? shadowCampaign(result.rows[0]) : undefined; }
  async activeShadowCampaigns(): Promise<readonly ShadowCampaign[]> { const result = await this.shadowDb.query<ShadowCampaignRow>(`SELECT ${shadowCampaignColumns} FROM shadow_campaigns WHERE state = 'active' ORDER BY created_at, id`); return result.rows.map(shadowCampaign); }

  async changeShadowCampaign(input: { id: string; action: 'pause' | 'resume' | 'complete'; actorCredentialId: string; actorTenantId: string }): Promise<ShadowCampaign> {
    if (!this.db.transaction) throw new Error('PostgresControlPlaneStore requires transactional SQL client');
    return this.db.transaction(async (tx) => {
      const current = await tx.query<ShadowCampaignRow>(`SELECT ${shadowCampaignColumns} FROM shadow_campaigns WHERE id = $1 FOR UPDATE`, [input.id]); const row = current.rows[0];
      if (!row) throw new RouterError('Shadow campaign was not found', 'shadow_campaign_not_found', 404, false);
      const valid = (input.action === 'pause' && row.state === 'active') || (input.action === 'resume' && row.state === 'paused') || (input.action === 'complete' && row.state !== 'completed');
      if (!valid) throw new RouterError('Shadow campaign action is invalid for its current state', 'shadow_campaign_state_conflict', 409, false);
      if (input.action === 'resume') {
        await tx.query("SELECT pg_advisory_xact_lock(hashtext('cosmy:shadow-campaigns'))");
        const active = await tx.query<{ count: string | number }>("SELECT COUNT(*) AS count FROM shadow_campaigns WHERE state = 'active'");
        if (Number(active.rows[0]?.count ?? 0) >= 64) throw new RouterError('The active shadow campaign limit has been reached', 'shadow_campaign_limit', 409, false);
      }
      const state = input.action === 'pause' ? 'paused' : input.action === 'resume' ? 'active' : 'completed'; let updated: SqlResult<ShadowCampaignRow>;
      try { updated = await tx.query<ShadowCampaignRow>(`UPDATE shadow_campaigns SET state = $2, updated_at = now() WHERE id = $1 RETURNING ${shadowCampaignColumns}`, [input.id, state]); }
      catch (error) { if ((error as { code?: string }).code === '23505') throw new RouterError('An active shadow campaign already exists for this model', 'shadow_campaign_conflict', 409, false); throw error; }
      await this.appendAudit(tx, input.actorCredentialId, input.actorTenantId, `shadow.${input.action}`, `shadow:${input.id}`, {}); return shadowCampaign(updated.rows[0]!);
    });
  }

  async reserveShadow(campaignId: string, estimatedCostUsd: number): Promise<ShadowReservation> {
    if (!Number.isFinite(estimatedCostUsd) || estimatedCostUsd < 0) throw new Error('Shadow estimate must be non-negative');
    if (!this.shadowDb.transaction) throw new Error('Shadow reservations require transactional SQL client');
    return this.shadowDb.transaction(async (tx) => {
      const updated = await tx.query<ShadowCampaignRow>(`UPDATE shadow_campaigns SET reserved_usd = reserved_usd + $2, updated_at = now() WHERE id = $1 AND state = 'active' AND spent_usd + reserved_usd + $2 <= budget_limit_usd RETURNING ${shadowCampaignColumns}`, [campaignId, estimatedCostUsd]);
      if (!updated.rows[0]) throw new RouterError('Shadow campaign is inactive or its budget would be exceeded', 'shadow_budget_exceeded', 409, false);
      const id = randomUUID(); await tx.query("INSERT INTO shadow_reservations (id, campaign_id, estimated_cost_usd, lease_expires_at) VALUES ($1, $2, $3, now() + interval '5 minutes')", [id, campaignId, estimatedCostUsd]); return { id, campaignId, estimatedCostUsd };
    });
  }

  async reconcileShadow(reservation: ShadowReservation, actualCostUsd: number): Promise<void> {
    await this.shadowDb.query("WITH reconciled AS (UPDATE shadow_reservations SET actual_cost_usd = $2, reconciled_at = now(), reconciliation_source = 'runtime' WHERE id = $1 AND reconciled_at IS NULL RETURNING campaign_id, estimated_cost_usd, actual_cost_usd) UPDATE shadow_campaigns AS campaigns SET reserved_usd = GREATEST(0, campaigns.reserved_usd - reconciled.estimated_cost_usd), spent_usd = campaigns.spent_usd + reconciled.actual_cost_usd, state = CASE WHEN campaigns.spent_usd + reconciled.actual_cost_usd >= campaigns.budget_limit_usd THEN 'completed' ELSE campaigns.state END, updated_at = now() FROM reconciled WHERE campaigns.id = reconciled.campaign_id", [reservation.id, Math.max(0, actualCostUsd)]);
  }

  async recordShadowObservation(observation: ShadowObservation): Promise<void> {
    if (!this.shadowDb.transaction) throw new Error('Shadow observations require transactional SQL client');
    await this.shadowDb.transaction(async (tx) => {
      await tx.query('INSERT INTO shadow_observations (id, campaign_id, primary_model_id, shadow_model_id, status, latency_ms, usage, primary_output_sha256, shadow_output_sha256, exact_match, recorded_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)', [observation.id, observation.campaignId, observation.primaryModelId, observation.shadowModelId, observation.status, observation.latencyMs, observation.usage ? JSON.stringify(observation.usage) : null, observation.primaryOutputSha256 ?? null, observation.shadowOutputSha256 ?? null, observation.exactMatch ?? null, observation.recordedAt]);
      await tx.query("UPDATE shadow_campaigns SET sample_count = sample_count + 1, success_count = success_count + CASE WHEN $2 = 'success' THEN 1 ELSE 0 END, error_count = error_count + CASE WHEN $2 = 'error' THEN 1 ELSE 0 END, updated_at = now() WHERE id = $1", [observation.campaignId, observation.status]);
    });
  }

  async reconcileExpiredShadows(limit = 100): Promise<number> {
    const result = await this.shadowDb.query<{ recovered_count: string | number }>("WITH candidates AS (SELECT id FROM shadow_reservations WHERE reconciled_at IS NULL AND lease_expires_at <= now() ORDER BY lease_expires_at FOR UPDATE SKIP LOCKED LIMIT $1), reconciled AS (UPDATE shadow_reservations AS reservations SET actual_cost_usd = reservations.estimated_cost_usd, reconciled_at = now(), reconciliation_source = 'lease-expiry' FROM candidates WHERE reservations.id = candidates.id RETURNING reservations.campaign_id, reservations.estimated_cost_usd), totals AS (SELECT campaign_id, SUM(estimated_cost_usd) AS recovered_usd FROM reconciled GROUP BY campaign_id), updated AS (UPDATE shadow_campaigns SET reserved_usd = GREATEST(0, shadow_campaigns.reserved_usd - totals.recovered_usd), spent_usd = shadow_campaigns.spent_usd + totals.recovered_usd, updated_at = now() FROM totals WHERE shadow_campaigns.id = totals.campaign_id RETURNING shadow_campaigns.id) SELECT COUNT(*) AS recovered_count FROM reconciled", [limit]); return Number(result.rows[0]?.recovered_count ?? 0);
  }

  private async appendAudit(db: SqlClient, actorCredentialId: string, actorTenantId: string, action: AuditEvent['action'], target: string, details: Record<string, unknown>): Promise<void> {
    await db.query('INSERT INTO admin_audit_events (id, actor_credential_id, actor_tenant_id, action, target, details) VALUES ($1, $2, $3, $4, $5, $6)', [randomUUID(), actorCredentialId, actorTenantId, action, target, JSON.stringify(details)]);
  }

  private async evidenceForWith(db: SqlClient, modelId: string, modelVersion: string): Promise<ModelPromotionEvidence | undefined> {
    const result = await db.query<EvidenceRow>('SELECT id, model_id, model_version, suite_version, dataset_version, conformance_passed, pricing_verified, usage_verified, routing_pass_rate, quality_score, sample_count, evaluated_at, expires_at, submitted_by_credential_id, submitted_at FROM model_promotion_evidence WHERE model_id = $1 AND model_version = $2 ORDER BY submitted_at DESC, id DESC LIMIT 1', [modelId, modelVersion]);
    return result.rows[0] ? promotionEvidence(result.rows[0]) : undefined;
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
