CREATE TABLE IF NOT EXISTS api_credentials (
  credential_id TEXT PRIMARY KEY CHECK (credential_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  tenant_id TEXT NOT NULL CHECK (tenant_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  key_sha256 TEXT NOT NULL UNIQUE CHECK (key_sha256 ~ '^[a-f0-9]{64}$'),
  scopes TEXT[] NOT NULL CHECK (cardinality(scopes) > 0 AND scopes <@ ARRAY['responses:create', 'routing:read', 'admin:read', 'admin:write', 'metrics:read']::TEXT[]),
  disabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS api_credentials_enabled_idx
  ON api_credentials (credential_id)
  WHERE disabled = false;

ALTER TABLE admin_audit_events DROP CONSTRAINT IF EXISTS admin_audit_events_action_check;
ALTER TABLE admin_audit_events ADD CONSTRAINT admin_audit_events_action_check
  CHECK (action IN ('models.publish', 'budget.set', 'credential.create', 'credential.disable', 'model_evidence.submit', 'rollout.start', 'rollout.promote', 'rollout.rollback', 'rollout.auto_rollback', 'shadow.start', 'shadow.pause', 'shadow.resume', 'shadow.complete'));
