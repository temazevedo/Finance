-- 001_initial_schema.sql

-- Accounts
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('checking','savings','cash','investment')),
  initial_balance_cents INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_accounts_active_name ON accounts(name) WHERE archived = 0;

-- Categories (hierarchical, max 2 levels)
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  parent_id INTEGER REFERENCES categories(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('income','expense')),
  budget_group TEXT CHECK (budget_group IN ('needs','wants','savings')),
  archived INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_categories_active_parent_name ON categories(parent_id, name) WHERE archived = 0;

-- Recurring items (income, expense, transfer)
CREATE TABLE IF NOT EXISTS recurring_items (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('income','expense','transfer')),
  name TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id),
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  to_account_id INTEGER REFERENCES accounts(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  is_estimate INTEGER NOT NULL DEFAULT 0,
  frequency TEXT NOT NULL CHECK (frequency IN
    ('weekly','biweekly','monthly','bimonthly','quarterly','semiannual','annual')),
  start_date TEXT NOT NULL,
  end_date TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (type <> 'transfer' OR (to_account_id IS NOT NULL AND to_account_id <> account_id)),
  CHECK (type = 'transfer' OR category_id IS NOT NULL)
);

-- Skipped occurrences for recurring generator
CREATE TABLE IF NOT EXISTS skipped_occurrences (
  recurring_id INTEGER NOT NULL REFERENCES recurring_items(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (recurring_id, date)
);

-- Transactions
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income','expense','transfer')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  to_account_id INTEGER REFERENCES accounts(id),
  category_id INTEGER REFERENCES categories(id),
  name TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('planned','confirmed')),
  recurring_id INTEGER REFERENCES recurring_items(id),
  import_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (type <> 'transfer' OR (to_account_id IS NOT NULL AND to_account_id <> account_id)),
  CHECK (type = 'transfer' OR category_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_tx_recurring_date ON transactions(recurring_id, date) WHERE recurring_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_tx_import_hash ON transactions(import_hash) WHERE import_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_tx_category_name ON transactions(category_id, name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS ix_tx_date ON transactions(date);

-- Budgets
CREATE TABLE IF NOT EXISTS budgets (
  id INTEGER PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  month TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  UNIQUE(category_id, month)
);

-- Settings
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
