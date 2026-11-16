CREATE TABLE IF NOT EXISTS tenant_policies (
  tenant_id TEXT PRIMARY KEY CHECK (tenant_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  version BIGINT NOT NULL CHECK (version > 0),
  allowed_providers TEXT[] CHECK (allowed_providers IS NULL OR cardinality(allowed_providers) <= 64),
  denied_providers TEXT[] CHECK (denied_providers IS NULL OR cardinality(denied_providers) <= 64),
  allowed_models TEXT[] CHECK (allowed_models IS NULL OR cardinality(allowed_models) <= 1000),
  denied_models TEXT[] CHECK (denied_models IS NULL OR cardinality(denied_models) <= 1000),
  allowed_regions TEXT[] CHECK (allowed_regions IS NULL OR cardinality(allowed_regions) <= 64),
  allowed_data_classes TEXT[] CHECK (allowed_data_classes IS NULL OR (cardinality(allowed_data_classes) > 0 AND allowed_data_classes <@ ARRAY['public', 'internal', 'confidential', 'restricted']::TEXT[])),
  max_cost_usd NUMERIC(18, 8) CHECK (max_cost_usd IS NULL OR max_cost_usd >= 0),
  max_latency_ms INTEGER CHECK (max_latency_ms IS NULL OR max_latency_ms > 0),
  min_quality DOUBLE PRECISION CHECK (min_quality IS NULL OR min_quality BETWEEN 0 AND 1),
  allow_fallback BOOLEAN,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE admin_audit_events DROP CONSTRAINT IF EXISTS admin_audit_events_action_check;
ALTER TABLE admin_audit_events ADD CONSTRAINT admin_audit_events_action_check
  CHECK (action IN ('models.publish', 'models.rollback', 'models.disable', 'budget.set', 'policy.set', 'credential.create', 'credential.disable', 'model_evidence.submit', 'rollout.start', 'rollout.promote', 'rollout.rollback', 'rollout.auto_rollback', 'shadow.start', 'shadow.pause', 'shadow.resume', 'shadow.complete'));
