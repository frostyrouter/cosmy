CREATE TABLE IF NOT EXISTS route_decisions (
  decision_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('planned', 'completed', 'failed', 'cancelled')),
  route JSONB NOT NULL,
  registry_version BIGINT,
  outcome JSONB,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, decision_id)
);

CREATE INDEX IF NOT EXISTS route_decisions_tenant_created_idx
  ON route_decisions (tenant_id, created_at DESC);
