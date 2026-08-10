CREATE TABLE IF NOT EXISTS model_promotion_evidence (
  id UUID PRIMARY KEY,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  suite_version TEXT NOT NULL,
  dataset_version TEXT NOT NULL,
  conformance_passed BOOLEAN NOT NULL,
  pricing_verified BOOLEAN NOT NULL,
  usage_verified BOOLEAN NOT NULL,
  routing_pass_rate DOUBLE PRECISION NOT NULL CHECK (routing_pass_rate BETWEEN 0 AND 1),
  quality_score DOUBLE PRECISION NOT NULL CHECK (quality_score BETWEEN 0 AND 1),
  sample_count INTEGER NOT NULL CHECK (sample_count >= 0),
  evaluated_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  submitted_by_credential_id TEXT NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS model_promotion_evidence_lookup
  ON model_promotion_evidence (model_id, model_version, submitted_at DESC, id DESC);

ALTER TABLE admin_audit_events DROP CONSTRAINT IF EXISTS admin_audit_events_action_check;
ALTER TABLE admin_audit_events ADD CONSTRAINT admin_audit_events_action_check
  CHECK (action IN ('models.publish', 'budget.set', 'model_evidence.submit'));
