CREATE TABLE IF NOT EXISTS model_rollouts (
  id UUID PRIMARY KEY,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('canary', 'active', 'rolled_back')),
  traffic_percentage DOUBLE PRECISION NOT NULL CHECK (traffic_percentage > 0 AND traffic_percentage <= 100),
  minimum_samples INTEGER NOT NULL CHECK (minimum_samples >= 20),
  maximum_error_rate DOUBLE PRECISION NOT NULL CHECK (maximum_error_rate >= 0 AND maximum_error_rate <= 1),
  maximum_average_latency_ms DOUBLE PRECISION NOT NULL CHECK (maximum_average_latency_ms > 0),
  sample_count BIGINT NOT NULL DEFAULT 0 CHECK (sample_count >= 0),
  error_count BIGINT NOT NULL DEFAULT 0 CHECK (error_count >= 0 AND error_count <= sample_count),
  total_latency_ms DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (total_latency_ms >= 0),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS model_rollouts_one_canary_per_model
  ON model_rollouts (model_id) WHERE state = 'canary';
CREATE INDEX IF NOT EXISTS model_rollouts_runtime_lookup
  ON model_rollouts (model_id, model_version, created_at DESC) WHERE state IN ('canary', 'active');

ALTER TABLE admin_audit_events DROP CONSTRAINT IF EXISTS admin_audit_events_action_check;
ALTER TABLE admin_audit_events ADD CONSTRAINT admin_audit_events_action_check
  CHECK (action IN ('models.publish', 'budget.set', 'model_evidence.submit', 'rollout.start', 'rollout.promote', 'rollout.rollback', 'rollout.auto_rollback'));
