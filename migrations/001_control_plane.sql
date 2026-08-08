CREATE TABLE IF NOT EXISTS model_registry_snapshots (
  version BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS model_manifests (
  snapshot_version BIGINT NOT NULL REFERENCES model_registry_snapshots(version),
  model_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model_name TEXT NOT NULL,
  manifest JSONB NOT NULL,
  PRIMARY KEY (snapshot_version, model_id)
);

CREATE TABLE IF NOT EXISTS provider_health_events (
  id BIGSERIAL PRIMARY KEY,
  model_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure')),
  latency_ms DOUBLE PRECISION,
  occurred_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS provider_health_events_model_time ON provider_health_events (model_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS usage_reservations (
  reservation_id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  estimated_cost_usd NUMERIC(18, 8) NOT NULL CHECK (estimated_cost_usd >= 0),
  actual_cost_usd NUMERIC(18, 8),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reconciled_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS usage_reservations_tenant_active ON usage_reservations (tenant_id) WHERE reconciled_at IS NULL;

CREATE TABLE IF NOT EXISTS response_usage (
  request_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens BIGINT NOT NULL,
  output_tokens BIGINT NOT NULL,
  total_tokens BIGINT NOT NULL,
  estimated_cost_usd NUMERIC(18, 8) NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL
);
