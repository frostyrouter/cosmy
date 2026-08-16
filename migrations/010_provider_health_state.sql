CREATE TABLE IF NOT EXISTS provider_health_state (
  model_id TEXT PRIMARY KEY,
  successes BIGINT NOT NULL DEFAULT 0 CHECK (successes >= 0),
  failures BIGINT NOT NULL DEFAULT 0 CHECK (failures >= 0),
  consecutive_failures BIGINT NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  last_latency_ms DOUBLE PRECISION,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
