ALTER TABLE usage_reservations
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reconciliation_source TEXT;

UPDATE usage_reservations
SET lease_expires_at = created_at + interval '5 minutes'
WHERE lease_expires_at IS NULL;

ALTER TABLE usage_reservations
  ALTER COLUMN lease_expires_at SET DEFAULT (now() + interval '5 minutes'),
  ALTER COLUMN lease_expires_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS usage_reservations_expired_active
  ON usage_reservations (lease_expires_at)
  WHERE reconciled_at IS NULL;
