-- V2 import staging tables (AGENT.md section 14.5)
CREATE TABLE IF NOT EXISTS import_profiles (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  config_json TEXT NOT NULL,          -- encoding, delimiter, skip rows, date format, separators, column map, cleanup rules
  created_by TEXT NOT NULL CHECK (created_by IN ('manual','agent')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS import_batches (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  profile_id INTEGER REFERENCES import_profiles(id),
  filename TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','committed','discarded')) DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS import_rows (
  id INTEGER PRIMARY KEY,
  batch_id INTEGER NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  date TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  type TEXT NOT NULL CHECK (type IN ('income','expense','transfer')),
  to_account_id INTEGER REFERENCES accounts(id),               -- set when the row is converted to a transfer
  description TEXT NOT NULL,
  name TEXT,                           -- proposed/edited name
  category_id INTEGER REFERENCES categories(id),
  match_status TEXT NOT NULL CHECK (match_status IN ('matched','ambiguous','needs_category','duplicate')),
  planned_transaction_id INTEGER REFERENCES transactions(id),  -- proposed reconciliation
  planned_accepted INTEGER NOT NULL DEFAULT 0,                 -- set when the user confirms the reconciliation
  excluded INTEGER NOT NULL DEFAULT 0,
  import_hash TEXT NOT NULL,
  raw_json TEXT
);

CREATE INDEX IF NOT EXISTS ix_import_rows_batch ON import_rows(batch_id);
CREATE INDEX IF NOT EXISTS ix_transactions_import_hash ON transactions(import_hash) WHERE import_hash IS NOT NULL;

-- Built-in profile for CGD "Consultar saldos e movimentos à ordem" exports:
-- 15 informational header lines, one column-header row, ; separated,
-- DD-MM-YYYY dates, decimal comma, thousands dot, signed amount column.
INSERT OR IGNORE INTO import_profiles (name, config_json, created_by) VALUES (
  'CGD — Movimentos à Ordem',
  '{"encoding":"utf8","delimiter":";","skip_rows":15,"has_header_row":true,"date_format":"DD-MM-YYYY","decimal_separator":",","thousand_separator":".","columns":{"date":0,"description":2,"amount":3},"cleanup_rules":[]}',
  'manual'
);
