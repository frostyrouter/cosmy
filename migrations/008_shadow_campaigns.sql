CREATE TABLE IF NOT EXISTS shadow_campaigns (
  id UUID PRIMARY KEY,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('active', 'paused', 'completed')),
  sample_percentage DOUBLE PRECISION NOT NULL CHECK (sample_percentage > 0 AND sample_percentage <= 100),
  budget_limit_usd NUMERIC(20,10) NOT NULL CHECK (budget_limit_usd >= 0),
  reserved_usd NUMERIC(20,10) NOT NULL DEFAULT 0 CHECK (reserved_usd >= 0),
  spent_usd NUMERIC(20,10) NOT NULL DEFAULT 0 CHECK (spent_usd >= 0),
  allowed_data_classes JSONB NOT NULL,
  sample_count BIGINT NOT NULL DEFAULT 0 CHECK (sample_count >= 0),
  success_count BIGINT NOT NULL DEFAULT 0 CHECK (success_count >= 0),
  error_count BIGINT NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (success_count + error_count <= sample_count)
);
CREATE UNIQUE INDEX IF NOT EXISTS shadow_campaigns_one_active_per_model
  ON shadow_campaigns (model_id) WHERE state = 'active';

CREATE TABLE IF NOT EXISTS shadow_reservations (
  id UUID PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES shadow_campaigns(id),
  estimated_cost_usd NUMERIC(20,10) NOT NULL CHECK (estimated_cost_usd >= 0),
  actual_cost_usd NUMERIC(20,10),
  lease_expires_at TIMESTAMPTZ NOT NULL,
  reconciled_at TIMESTAMPTZ,
  reconciliation_source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shadow_reservations_recovery ON shadow_reservations (lease_expires_at) WHERE reconciled_at IS NULL;

CREATE TABLE IF NOT EXISTS shadow_observations (
  id UUID PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES shadow_campaigns(id),
  primary_model_id TEXT NOT NULL,
  shadow_model_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'error')),
  latency_ms DOUBLE PRECISION NOT NULL CHECK (latency_ms >= 0),
  usage JSONB,
  primary_output_sha256 TEXT CHECK (primary_output_sha256 IS NULL OR primary_output_sha256 ~ '^[a-f0-9]{64}$'),
  shadow_output_sha256 TEXT CHECK (shadow_output_sha256 IS NULL OR shadow_output_sha256 ~ '^[a-f0-9]{64}$'),
  exact_match BOOLEAN,
  recorded_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS shadow_observations_campaign_time ON shadow_observations (campaign_id, recorded_at DESC);

ALTER TABLE admin_audit_events DROP CONSTRAINT IF EXISTS admin_audit_events_action_check;
ALTER TABLE admin_audit_events ADD CONSTRAINT admin_audit_events_action_check
  CHECK (action IN ('models.publish', 'budget.set', 'model_evidence.submit', 'rollout.start', 'rollout.promote', 'rollout.rollback', 'rollout.auto_rollback', 'shadow.start', 'shadow.pause', 'shadow.resume', 'shadow.complete'));
