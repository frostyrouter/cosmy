CREATE TABLE IF NOT EXISTS tenant_budgets (
  tenant_id TEXT PRIMARY KEY,
  limit_usd NUMERIC(18, 8) NOT NULL CHECK (limit_usd >= 0),
  reserved_usd NUMERIC(18, 8) NOT NULL DEFAULT 0 CHECK (reserved_usd >= 0),
  spent_usd NUMERIC(18, 8) NOT NULL DEFAULT 0 CHECK (spent_usd >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tenant_budgets_updated_at ON tenant_budgets (updated_at);
