-- Interest configuration on accounts (issue: investment accounts)
ALTER TABLE accounts ADD COLUMN interest_rate REAL;
ALTER TABLE accounts ADD COLUMN interest_period TEXT CHECK (interest_period IN ('monthly','annual'));

-- Idempotency ledger for auto-generated interest income.
-- period: 'YYYY-MM' for monthly accounts, 'YYYY' for annual accounts.
CREATE TABLE IF NOT EXISTS interest_postings (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  period TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  posted_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_id, period)
);
