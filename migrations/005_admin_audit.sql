CREATE TABLE IF NOT EXISTS admin_audit_events (
  id UUID PRIMARY KEY,
  actor_credential_id TEXT NOT NULL,
  actor_tenant_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('models.publish', 'budget.set')),
  target TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_audit_events_time
  ON admin_audit_events (occurred_at DESC, id DESC);
