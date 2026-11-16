ALTER TABLE route_decisions
  DROP CONSTRAINT IF EXISTS route_decisions_state_check;

ALTER TABLE route_decisions
  ALTER COLUMN route DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS rejection JSONB,
  ADD COLUMN IF NOT EXISTS attempts JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE route_decisions
  ADD CONSTRAINT route_decisions_state_check
    CHECK (state IN ('planned', 'completed', 'failed', 'cancelled', 'rejected')),
  ADD CONSTRAINT route_decisions_payload_check
    CHECK (
      (state = 'rejected' AND route IS NULL AND rejection IS NOT NULL)
      OR
      (state <> 'rejected' AND route IS NOT NULL AND rejection IS NULL)
    );
