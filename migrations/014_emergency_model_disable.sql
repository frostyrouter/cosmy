ALTER TABLE admin_audit_events DROP CONSTRAINT IF EXISTS admin_audit_events_action_check;
ALTER TABLE admin_audit_events ADD CONSTRAINT admin_audit_events_action_check
  CHECK (action IN ('models.publish', 'models.rollback', 'models.disable', 'budget.set', 'credential.create', 'credential.disable', 'model_evidence.submit', 'rollout.start', 'rollout.promote', 'rollout.rollback', 'rollout.auto_rollback', 'shadow.start', 'shadow.pause', 'shadow.resume', 'shadow.complete'));
