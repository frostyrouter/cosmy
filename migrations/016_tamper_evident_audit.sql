CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE admin_audit_events
  ADD COLUMN IF NOT EXISTS chain_sequence BIGINT,
  ADD COLUMN IF NOT EXISTS previous_hash TEXT,
  ADD COLUMN IF NOT EXISTS event_hash TEXT;

DO $$
DECLARE
  event RECORD;
  sequence_value BIGINT := 0;
  prior_hash TEXT := repeat('0', 64);
  calculated_hash TEXT;
BEGIN
  FOR event IN
    SELECT id, actor_credential_id, actor_tenant_id, action, target, details, occurred_at
    FROM admin_audit_events
    ORDER BY occurred_at, id
  LOOP
    sequence_value := sequence_value + 1;
    calculated_hash := encode(digest(convert_to(jsonb_build_object(
      'v', 1, 'sequence', sequence_value, 'previousHash', prior_hash,
      'id', event.id::text, 'actorCredentialId', event.actor_credential_id,
      'actorTenantId', event.actor_tenant_id, 'action', event.action,
      'target', event.target, 'details', event.details,
      'occurredAt', to_char(event.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    )::text, 'UTF8'), 'sha256'), 'hex');
    UPDATE admin_audit_events
    SET chain_sequence = sequence_value, previous_hash = prior_hash, event_hash = calculated_hash
    WHERE id = event.id;
    prior_hash := calculated_hash;
  END LOOP;
END $$;

ALTER TABLE admin_audit_events
  ALTER COLUMN chain_sequence SET NOT NULL,
  ALTER COLUMN previous_hash SET NOT NULL,
  ALTER COLUMN event_hash SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS admin_audit_events_chain_sequence
  ON admin_audit_events (chain_sequence);

ALTER TABLE admin_audit_events DROP CONSTRAINT IF EXISTS admin_audit_events_previous_hash_check;
ALTER TABLE admin_audit_events ADD CONSTRAINT admin_audit_events_previous_hash_check CHECK (previous_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE admin_audit_events DROP CONSTRAINT IF EXISTS admin_audit_events_event_hash_check;
ALTER TABLE admin_audit_events ADD CONSTRAINT admin_audit_events_event_hash_check CHECK (event_hash ~ '^[0-9a-f]{64}$');

CREATE OR REPLACE FUNCTION append_admin_audit_event(
  event_id UUID, actor_credential TEXT, actor_tenant TEXT, event_action TEXT,
  event_target TEXT, event_details JSONB
) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  sequence_value BIGINT;
  prior_hash TEXT;
  occurred TIMESTAMPTZ := clock_timestamp();
  calculated_hash TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('cosmy:admin-audit-chain'));
  SELECT chain_sequence, event_hash INTO sequence_value, prior_hash
  FROM admin_audit_events ORDER BY chain_sequence DESC LIMIT 1;
  sequence_value := COALESCE(sequence_value, 0) + 1;
  prior_hash := COALESCE(prior_hash, repeat('0', 64));
  calculated_hash := encode(digest(convert_to(jsonb_build_object(
    'v', 1, 'sequence', sequence_value, 'previousHash', prior_hash,
    'id', event_id::text, 'actorCredentialId', actor_credential,
    'actorTenantId', actor_tenant, 'action', event_action,
    'target', event_target, 'details', event_details,
    'occurredAt', to_char(occurred AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  )::text, 'UTF8'), 'sha256'), 'hex');
  INSERT INTO admin_audit_events (
    id, actor_credential_id, actor_tenant_id, action, target, details, occurred_at,
    chain_sequence, previous_hash, event_hash
  ) VALUES (
    event_id, actor_credential, actor_tenant, event_action, event_target, event_details, occurred,
    sequence_value, prior_hash, calculated_hash
  );
END $$;
