# AGENT.md — Personal Budgeting & Transaction Tracker

This file is the source of truth for building this project. Read it fully before writing code. When a requirement is ambiguous, prefer the simplest solution that satisfies the spec and note the assumption in `docs/DECISIONS.md`.

## 1. Project Overview

A complete, local-first web app for budgeting and recording financial transactions (personal/family use). It runs as a single Node process serving both the API and the built React client, backed by a SQLite file. Remote access will be added later through Tailscale. Authentication and hardening are intentionally out of scope for now (see Section 9).

Primary user language for the UI: **Portuguese (pt-PT)**. Code, comments, identifiers, commit messages and documentation: **English**. Currency: **EUR**. Locale for formatting: `pt-PT`.

## 2. Tech Stack (fixed)

- **Backend:** Node.js (LTS), Express, `better-sqlite3` (synchronous), `zod` for validation.
- **Frontend:** Vite, React, React Router, TanStack Query, `react-hook-form` (with zod resolver), Tailwind CSS.
- **Database:** SQLite, single file (`data/app.db`), WAL mode, `PRAGMA foreign_keys = ON`.
- **Language:** JavaScript (ES modules). No TypeScript unless requested. Use JSDoc where types help.
- **Tests:** Vitest (unit/integration on the server; component tests on key client pieces).
- **Deployment shape:** one process; Express serves `client/dist` and `/api/*`.

Do not introduce additional frameworks (no ORM, no Redux). Tailwind CSS is used for styling and responsive mobile-first UI.

## 3. Repository Structure

```
/
├── AGENT.md
├── package.json              # root scripts (dev, build, start, test, migrate)
├── docs/
│   └── DECISIONS.md
├── server/
│   ├── src/
│   │   ├── index.js          # app bootstrap
│   │   ├── db.js             # connection + pragmas
│   │   ├── migrate.js        # migration runner
│   │   ├── migrations/       # NNN_description.sql, applied in order
│   │   ├── routes/
│   │   ├── services/         # business logic (recurrence generator, budgets, suggestions)
│   │   └── schemas/          # zod schemas
│   └── tests/
├── client/
│   ├── src/
│   │   ├── api/              # fetch wrappers + TanStack Query hooks
│   │   ├── components/
│   │   ├── pages/
│   │   └── main.jsx
│   └── vite.config.js
└── data/                     # SQLite file + backups (gitignored)
```

## 4. Global Conventions

- **Money:** always stored and computed as **integer cents** (`*_cents`). Never use floats for money. Convert to/from display strings only at the UI boundary (`Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' })`).
- **Dates:** ISO strings `YYYY-MM-DD` stored as TEXT. Timestamps (`created_at`) as ISO UTC. Use a dedicated date-only helper module for all date arithmetic and month-end clamping (e.g. a monthly item anchored on the 31st falls on the last day of shorter months). Never parse `YYYY-MM-DD` strings directly with native JavaScript `new Date("YYYY-MM-DD")` in business or display logic to avoid UTC timezone-offset off-by-one errors in WET/WEST (pt-PT).
- **Sign convention:** `amount_cents` is always positive. Direction is determined by `type` (`income`, `expense`, `transfer`).
- **Validation:** every request body/query is validated with zod; return `400` with a structured error on failure.
- **Errors:** consistent JSON shape `{ "error": { "code": string, "message": string, "details"?: any } }`.
- **Migrations:** forward-only SQL files, run automatically at startup inside a transaction. Never edit an applied migration; add a new one.
- **Transactions (DB):** wrap multi-statement writes in `db.transaction(...)`.
- **Soft vs hard delete:** use `active`/`archived` flags for accounts, categories and recurring items; hard-delete only transactions (with confirmation in UI). Partial unique indexes (`WHERE archived = 0`) allow archived names to be reused or un-archived in the UI without collision.

## 5. Data Model

### 5.1 accounts
```sql
CREATE TABLE accounts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('checking','savings','cash','investment')),
  initial_balance_cents INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX ux_accounts_active_name ON accounts(name) WHERE archived = 0;
```
Account balance = `initial_balance_cents` + sum of **confirmed** income − confirmed expenses ± confirmed transfers. Planned transactions never affect the balance.

### 5.2 categories (hierarchical)
```sql
CREATE TABLE categories (
  id INTEGER PRIMARY KEY,
  parent_id INTEGER REFERENCES categories(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('income','expense')),
  budget_group TEXT CHECK (budget_group IN ('needs','wants','savings')), -- for 50/30/20 views
  archived INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX ux_categories_active_parent_name ON categories(parent_id, name) WHERE archived = 0;
```
- Two levels max (parent → child). A category is considered a **leaf** if it has no children (either a subcategory with a parent, or a standalone top-level category that has no children). Transactions may **only** reference leaf categories. Enforce in the service layer.
- Seed a sensible default tree on first run (pt-PT names), e.g. Habitação → Renda/Prestação, Eletricidade, Água, Gás, Internet/TV/Telemóvel, Condomínio; Alimentação → Supermercado, Restaurantes; Transportes → Combustível, Transportes públicos, Seguro automóvel, Manutenção; Saúde; Lazer; Subscrições; Educação; Impostos; Poupança; Rendimentos → Salário, Outros. Keep the seed in a migration or `seed.js`, easily editable.

### 5.3 transactions
```sql
CREATE TABLE transactions (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income','expense','transfer')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  to_account_id INTEGER REFERENCES accounts(id),          -- only for transfers
  category_id INTEGER REFERENCES categories(id),          -- NULL for transfers
  name TEXT,                                              -- payee/description label, NULL for transfers allowed
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('planned','confirmed')),
  recurring_id INTEGER REFERENCES recurring_items(id),
  import_hash TEXT,                                       -- phase 2: dedupe imported rows
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (type <> 'transfer' OR (to_account_id IS NOT NULL AND to_account_id <> account_id)),
  CHECK (type = 'transfer' OR category_id IS NOT NULL)
);
CREATE UNIQUE INDEX ux_tx_recurring_date ON transactions(recurring_id, date) WHERE recurring_id IS NOT NULL;
CREATE UNIQUE INDEX ux_tx_import_hash ON transactions(import_hash) WHERE import_hash IS NOT NULL;
CREATE INDEX ix_tx_category_name ON transactions(category_id, name COLLATE NOCASE);
CREATE INDEX ix_tx_date ON transactions(date);
```
**Transfers are not income or expense.** Exclude them from all budget/report totals; they only move balance between accounts.

Optional: a simple `tags` / `transaction_tags` pair can be added later; not required for the MVP.

### 5.4 budgets
```sql
CREATE TABLE budgets (
  id INTEGER PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  month TEXT NOT NULL,                  -- 'YYYY-MM'
  amount_cents INTEGER NOT NULL,
  UNIQUE(category_id, month)
);
```
Budgets can be set at leaf level; parent totals are computed by summing children. Budget tracking accounts for rollover (unspent surplus or overspent deficits carried over from the prior month).

### 5.5 recurring_items
```sql
CREATE TABLE recurring_items (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('income','expense','transfer')),
  name TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id),             -- NULL for transfers
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  to_account_id INTEGER REFERENCES accounts(id),             -- only for transfers
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  is_estimate INTEGER NOT NULL DEFAULT 0,   -- variable amount (e.g. electricity)
  frequency TEXT NOT NULL CHECK (frequency IN
    ('weekly','biweekly','monthly','bimonthly','quarterly','semiannual','annual')),
  start_date TEXT NOT NULL,                 -- anchor: defines day-of-month / base date
  end_date TEXT,                            -- NULL = no end
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (type <> 'transfer' OR (to_account_id IS NOT NULL AND to_account_id <> account_id)),
  CHECK (type = 'transfer' OR category_id IS NOT NULL)
);
```

### 5.6 skipped_occurrences
```sql
CREATE TABLE skipped_occurrences (
  recurring_id INTEGER NOT NULL REFERENCES recurring_items(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (recurring_id, date)
);
```

### 5.7 settings
```sql
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
```
Known keys: `onboarding_completed` (`'true'`), `onboarding_step` (last completed step), `generator_last_run` (date), `budget_method` (`'50_30_20' | 'zero_based' | 'envelope'`).

## 6. Core Behaviors

### 6.1 New transaction form — category first, then name suggestions by usage

**Requirement:** when creating a transaction, the user selects the **category first**. The **name** field then offers the names previously used in that category, **ordered by usage frequency (most used first)**.

Form rules:
1. Field order: type → account → **category** → **name** → amount → date → notes.
2. The `name` field is disabled until a category is chosen (not applicable for transfers).
3. `name` is an **editable combobox**: shows suggestions, filters as the user types (prefix match; optionally also substring match ranked after prefix matches), and accepts a brand-new value.
4. Selecting a suggestion pre-fills `amount` with the **last amount used for that name in that category** (user can edit it).
5. Cold start: names from active `recurring_items` in that category must appear as suggestions even with zero usage.
6. Only leaf categories are selectable for transactions.

Suggestions query (core of `GET /api/suggestions/names`):
```sql
WITH RankedTransactions AS (
  SELECT
    name,
    amount_cents,
    date,
    ROW_NUMBER() OVER (
      PARTITION BY name COLLATE NOCASE
      ORDER BY date DESC, id DESC
    ) AS rn,
    COUNT(*) OVER (
      PARTITION BY name COLLATE NOCASE
    ) AS uses,
    MAX(date) OVER (
      PARTITION BY name COLLATE NOCASE
    ) AS last_used
  FROM transactions
  WHERE category_id = :categoryId
    AND name IS NOT NULL AND TRIM(name) <> ''
    AND name LIKE :prefix || '%' COLLATE NOCASE
),
HistoricalSuggestions AS (
  SELECT
    name,
    uses,
    last_used,
    amount_cents AS last_amount_cents
  FROM RankedTransactions
  WHERE rn = 1
),
RecurringSuggestions AS (
  SELECT
    name,
    0 AS uses,
    start_date AS last_used,
    amount_cents AS last_amount_cents
  FROM recurring_items
  WHERE category_id = :categoryId
    AND active = 1
    AND name LIKE :prefix || '%' COLLATE NOCASE
    AND name COLLATE NOCASE NOT IN (SELECT name FROM HistoricalSuggestions)
)
SELECT name, uses, last_used, last_amount_cents
FROM (
  SELECT * FROM HistoricalSuggestions
  UNION ALL
  SELECT * FROM RecurringSuggestions
)
ORDER BY uses DESC, last_used DESC, name COLLATE NOCASE ASC
LIMIT 10;
```
This single query computes usage counts, most recent date, and `last_amount_cents` for each unique name, while merging active recurring item names as zero-usage suggestions.

Normalization:
- `trim()` and collapse inner whitespace on save.
- Compare case-insensitively. On save, if a case-insensitive match already exists in that category, **reuse the most frequently used spelling** instead of creating a variant.

No separate "names" table: suggestions are derived from `transactions` so they never go out of sync.

Debounce input (≈150 ms) and cache with TanStack Query keyed by `(categoryId, prefix)`.

### 6.2 First-use onboarding — regular income and expenses with periodicity

**Requirement:** on first use the user must declare all expected **regular incomes** and **regular expenses**, each with a **periodicity**.

Gate: if `settings.onboarding_completed` is not `'true'`, every client route redirects to `/onboarding`, and the API still works (so the wizard can save), but the UI blocks other pages.

Wizard steps (persist progress after each step in `settings.onboarding_step` and in the DB itself, so closing the browser mid-way is safe and the wizard resumes):
1. **Accounts & opening balances** — at least one account required.
2. **Regular incomes** — name, amount, frequency, next/anchor date, destination account, category (from income categories). At least one income is required (allow "skip with confirmation").
3. **Regular expenses & regular transfers** — same form; categories pre-loaded; offer quick-add chips for common items (rent/mortgage, electricity, water, gas, internet, mobile, insurance, subscriptions) as well as regular transfers (e.g. monthly savings to savings account). Allow marking `is_estimate` for variable amounts.
4. **Estimated variable spending (optional)** — monthly budget per category for things like groceries, fuel, leisure.
5. **Summary** — show monthly-equivalent income, fixed expenses, variable budget, and estimated surplus; user confirms. On confirm: create initial budgets, run the generator, set `onboarding_completed = 'true'`.

The same form components must be reused by the post-onboarding **Recurring Items** screen (CRUD at any time).

Monthly-equivalent conversion (used for budget pre-fill and the summary):

| frequency  | monthly equivalent      |
|------------|-------------------------|
| weekly     | amount × 52 / 12        |
| biweekly   | amount × 26 / 12        |
| monthly    | amount                  |
| bimonthly  | amount / 2              |
| quarterly  | amount / 3              |
| semiannual | amount / 6              |
| annual     | amount / 12             |

Round only at the final aggregation step (keep cents consistent; distribute rounding remainder deterministically).

### 6.3 Recurrence generator (planned transactions)

A service that materializes `recurring_items` into `transactions` with `status = 'planned'` for a rolling horizon (default **60 days** ahead).

- Runs at server start, after any recurring-item create/update, and once daily (simple `setInterval` or `node-cron`).
- Supports `income`, `expense`, and `transfer` (transfers populate `to_account_id` and have `category_id = NULL`).
- **Idempotent:** use `INSERT ... ON CONFLICT DO NOTHING` relying on `ux_tx_recurring_date`.
- Computes occurrences from `start_date` per `frequency`, respecting `end_date` and `active`, with month-end clamping.
- Checks `skipped_occurrences(recurring_id, date)` so skipped or deleted occurrences are omitted from generation.
- When a recurring item is edited, future `planned` transactions generated from it (and not confirmed) are regenerated; confirmed ones are never touched.
- When deactivated or ended, future `planned` transactions are removed.
- Planned transactions do not affect account balances or "actual" totals; they feed "planned vs. actual" and cash-flow forecasts.

### 6.4 Confirming planned transactions

Planned items appear in an "Upcoming" list. The user confirms each with one click: the amount is pre-filled and editable (essential when `is_estimate = 1`), the date can be adjusted. Confirming sets `status = 'confirmed'` and updates amount/date. The user can also skip/delete a single occurrence without affecting the recurrence (deleted occurrences must not be regenerated: recorded in `skipped_occurrences(recurring_id, date)` checked by the generator).

### 6.5 Budgets and planned-vs-actual

- Budget per leaf category per month; parent categories aggregate.
- Initial budgets are pre-filled from recurring items' monthly equivalents plus onboarding step 4.
- **Budget rollover (unspent & overspent handling):**
  - Track cumulative carryover from the preceding month: `carryover_cents = previous_available_cents - previous_actual_cents`.
  - `available_cents = budgeted_cents + carryover_cents`.
  - Unspent surplus from previous months rolls over (increasing available spending).
  - Overspent deficit rolls over as a negative adjustment (reducing available spending in the following month).
  - `remaining_cents = available_cents - actual_cents`.
- Month view: for each category show budgeted, carryover, available, actual (confirmed), remaining, and a progress indicator; highlight overspent categories.
- "Surplus" = expected monthly income − fixed expenses − variable budget.
- Support the three methods as **views over the same data** (not separate data models): 50/30/20 using `categories.budget_group`, zero-based (every euro assigned, show unassigned remainder), and envelope (hard per-category limits with alerts and rollover balances).

## 7. API (REST, JSON, prefix `/api`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | liveness |
| GET/POST | `/accounts` | list / create |
| PATCH | `/accounts/:id` | update / archive |
| GET | `/accounts/balances` | current balance per account (confirmed only) |
| GET/POST | `/categories` | list tree / create |
| PATCH | `/categories/:id` | update / archive |
| GET | `/transactions` | filters: `from`, `to`, `account`, `category`, `type`, `status`, `q`, pagination |
| POST | `/transactions` | create (validates leaf category, transfer rules) |
| PATCH | `/transactions/:id` | update (incl. confirming planned) |
| DELETE | `/transactions/:id` | delete (recurring-generated: record skip) |
| GET | `/suggestions/names` | `categoryId` (required), `q` (optional) → ranked names + `last_amount_cents` |
| GET/POST | `/recurring` | list / create (triggers generator, supports transfers) |
| PATCH/DELETE | `/recurring/:id` | update / deactivate |
| GET | `/recurring/summary` | monthly-equivalent totals and surplus |
| GET/PUT | `/budgets?month=YYYY-MM` | read / bulk upsert budgets for a month (accepts array of `{ category_id, amount_cents }`) |
| GET | `/reports/budget-vs-actual?month=YYYY-MM` | per-category comparison including rollover carryover |
| GET | `/reports/cashflow?from&to` | planned + actual projection |
| GET | `/onboarding/state` | current step + completion |
| PUT | `/onboarding/step` | save progress |
| POST | `/onboarding/complete` | finalize (budgets, generator, flag) |
| GET | `/settings/backup` | download SQLite database backup file |
| GET | `/settings/export/csv` | download transactions CSV export |

Return money as integer cents plus nothing else; formatting is the client's job.

## 8. Frontend Screens

- `/onboarding` — multi-step wizard (Section 6.2).
- `/` Dashboard — account balances, month budget progress, upcoming planned items, surplus.
- `/transactions` — filterable table + "New transaction" drawer/modal (Section 6.1).
- `/upcoming` — planned transactions with one-click confirm.
- `/budgets` — month selector, per-category budget editing with rollover carryovers, method view switcher.
- `/recurring` — CRUD for recurring incomes/expenses/transfers (shared components with onboarding).
- `/accounts`, `/categories` — management.
- `/settings` — budget method, download DB backup, export transactions CSV.

UX requirements: Tailwind CSS for responsive mobile-friendly UI, keyboard-friendly forms (full combobox keyboard support: arrows, Enter, Esc), mobile-optimized navigation and layouts, accessible labels, pt-PT strings centralized in one file for future i18n, optimistic updates where safe.

## 9. Security (out of scope for now)

Authentication, session handling, rate limiting and security headers are **not part of the current scope**. Do not implement them and do not add related dependencies. They will be added later, if needed, before exposing the app through Tailscale.

Minimal baseline that still applies (no extra work required):
- Bind to `127.0.0.1` by default; make host/port configurable via env (`HOST`, `PORT`).
- Use parameterized queries only (never string-concatenate SQL) and validate all input with zod.
- Never store bank credentials. Imports (v2) use exported files only.

## 10. Data Safety

- Provide `npm run backup` that uses SQLite's online backup API (`better-sqlite3` `.backup()`) into `data/backups/` with timestamps, and an automatic daily backup with retention (e.g. keep last 14).
- Provide web UI triggers in `/settings` to download the SQLite database backup file and export transactions as CSV directly from the browser/phone without requiring terminal access.

## 11. Delivery Plan (build in this order; each milestone must run and be tested)

**Milestone 1 — Foundation**
- Repo scaffold, root scripts, Tailwind CSS setup, DB connection, migration runner, schema from Section 5 (including `skipped_occurrences` and partial unique indexes for active items), category seed, `/health`, Express serving the client build, Vite dev proxy.

**Milestone 2 — Core CRUD**
- Accounts, categories (leaf rule supporting standalone root categories as leaves), transactions (including transfers), balances endpoint. Basic transactions page and new-transaction form.

**Milestone 3 — Name suggestions (Section 6.1)**
- Single-query CTE suggestions endpoint with ranking and `last_amount_cents`, combobox component, normalization on save, tests for ranking/tie-breaks/cold start.

**Milestone 4 — Recurrence & onboarding (Sections 6.2–6.4)**
- Recurring CRUD (incomes, expenses, and transfers), strict calendar-safe date helper with month-end clamping, idempotent generator with `skipped_occurrences` tracking, onboarding wizard with resumable progress and summary, upcoming list with confirm flow.

**Milestone 5 — Budgets & reports (Section 6.5)**
- Bulk budget editing (`PUT /budgets`), budget rollover (tracking unspent surplus and overspent deficits), budget-vs-actual, cashflow projection, dashboard, method views.

**Milestone 6 — Hardening**
- CLI backups and web UI backup/export triggers in `/settings`, CSV export, README with run/deploy notes (including how to bind to a different interface for Tailscale later).

**V2 (not in scope until requested):** bank statement CSV import, see Section 14. Other later ideas: budget-exceeded alerts, savings goals, PDF/Excel report export (e.g. for IRS preparation).

## 12. Testing & Acceptance Criteria

Automated tests must cover at least:
- Suggestions: ordering by uses desc, tie-break by last use, case-insensitive grouping, prefix filter, cold-start from recurring items, spelling normalization, and `last_amount_cents` correctness.
- Recurrence generator: every frequency, month-end clamping, `end_date`, recurring transfers, idempotency (running twice creates no duplicates), regeneration after edit without touching confirmed items, skipped occurrences recorded in `skipped_occurrences` and not recreated.
- Monthly-equivalent conversion and onboarding summary totals.
- Transfers excluded from income/expense/budget totals; balances correct with planned items ignored.
- Validation: non-leaf category rejected (while standalone categories without children are accepted), transfer with same account rejected, non-positive amounts rejected.
- Budget rollover: carrying forward unspent surplus and overspent deficits correctly across consecutive months.

Done means: all tests pass, `npm run build && npm start` serves the full app from one process, a fresh database redirects to onboarding, and completing onboarding yields budgets, planned transactions and a correct surplus summary.

## 13. Working Agreements for the Agent

- Work milestone by milestone; do not start the next before the current one runs and its tests pass.
- Keep commits small and descriptive; keep business logic in `services/`, not in route handlers or React components.
- Do not add dependencies beyond Section 2 without recording the reason in `docs/DECISIONS.md`.
- Never use floating point for money and never store formatted money strings.
- If a requirement conflicts with another, stop and ask rather than guessing silently.

## 14. V2 — Bank Statement CSV Import (future; do not build until requested)

Goal: import CSV files exported from bank apps, turn them into transactions, and assign categories **by reusing what the user already recorded**. Anything that cannot be matched is flagged for the user to categorize manually.

### 14.1 Flow

1. **Upload** a CSV and pick the target account.
2. **Parse** the file into normalized rows (Section 14.2).
3. **Dedupe** against existing transactions (Section 14.4).
4. **Match** each row to a name/category from existing transactions (Section 14.3).
5. **Review screen:** rows grouped as *matched*, *needs category*, *duplicate (skipped)*. The user fixes every *needs category* row manually, may override any match, and may exclude rows.
6. **Commit** in a single DB transaction. Nothing is written to `transactions` before this step.

### 14.2 Parsing (scripts first, agent as fallback)

Normalized row shape: `{ date: 'YYYY-MM-DD', amount_cents: int > 0, type: 'income'|'expense', description: string, raw: object }`. The sign of the bank amount (or separate debit/credit columns) determines `type`.

Two interchangeable strategies behind one interface (`parseStatement(file, account) -> rows`):

- **Script profiles (default):** a saved *import profile* per bank/format describes encoding, delimiter, header rows to skip, date format, decimal/thousand separators, and column mapping (date, description, amount or debit/credit, optional balance). Stored in an `import_profiles` table (JSON config). Profiles are applied deterministically with no network calls.
- **Agent via API (fallback for unknown formats):** if no profile matches, send **only the header and a small sample of rows (e.g. first 10)** to the Anthropic API and ask for a profile in a strict JSON schema (validated with zod). The user reviews the proposed mapping and a preview of parsed rows, confirms, and the profile is **saved for reuse**, so later imports of that format run script-only. The agent proposes parsing configuration; it does **not** decide categories.
- The agent fallback is opt-in per import, requires `ANTHROPIC_API_KEY` in `.env`, and the UI must state clearly that sample rows are sent to an external service. The app must work fully without it (manual profile editor as the alternative).

### 14.3 Category matching (deterministic, no guessing)

Rule requested by the user:

1. Normalize the row description: trim, collapse whitespace, case-insensitive, strip accents for comparison. Optional per-profile cleanup rules (e.g. remove a known prefix such as "COMPRA ") may be configured, but must be explicit and visible in the profile.
2. Look for existing transactions whose `name` equals the normalized description (same normalization).
3. **If found:** assign the category used by those transactions and reuse the most frequently used spelling of the name. If that name appears under several categories, pick the most used one and mark the row *ambiguous* (shown with an indicator so the user can confirm).
4. **If not found:** mark the row *needs category*. **Do not use fuzzy matching or AI to guess a category.** The user selects the category manually (same leaf-category picker as the normal form).
5. When the user commits, the new name+category pair is naturally learned, because the saved transactions become the source for future matches (and for the name suggestions in Section 6.1). No separate rules table is needed in v2.

The commit button stays disabled while any non-excluded row lacks a category.

### 14.4 Deduplication and reconciliation

- `import_hash = sha256(account_id | date | amount_cents | normalized_description | occurrence_index)`, where `occurrence_index` distinguishes identical rows on the same day within the same file. Rows whose hash already exists are shown as *duplicates* and skipped by default.
- **Planned transactions:** before creating a new transaction, check for a `planned` transaction on the same account with the same amount (or within a configurable tolerance when `is_estimate = 1`) and a date within ±5 days, and with the same category/name when available. If found, offer to **confirm that planned transaction** with the imported date and amount instead of creating a duplicate. This must be confirmed by the user in the review screen, never automatic.
- Transfers between own accounts cannot be reliably detected from CSV; imported rows are always income/expense. The user can convert a row to a transfer in the review screen.

### 14.5 Data model additions (new migration)

```sql
CREATE TABLE import_profiles (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  config_json TEXT NOT NULL,          -- encoding, delimiter, skip rows, date format, separators, column map, cleanup rules
  created_by TEXT NOT NULL CHECK (created_by IN ('manual','agent')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE import_batches (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  profile_id INTEGER REFERENCES import_profiles(id),
  filename TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','committed','discarded')) DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE import_rows (
  id INTEGER PRIMARY KEY,
  batch_id INTEGER NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  type TEXT NOT NULL CHECK (type IN ('income','expense','transfer')),
  description TEXT NOT NULL,
  name TEXT,                           -- proposed/edited name
  category_id INTEGER REFERENCES categories(id),
  match_status TEXT NOT NULL CHECK (match_status IN ('matched','ambiguous','needs_category','duplicate')),
  planned_transaction_id INTEGER REFERENCES transactions(id),  -- proposed reconciliation
  excluded INTEGER NOT NULL DEFAULT 0,
  import_hash TEXT NOT NULL,
  raw_json TEXT
);
```

### 14.6 API additions

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/imports` | upload CSV (multipart) + `accountId` (+ optional `profileId`); returns batch with parsed rows or a proposal flow if no profile |
| POST | `/imports/propose-profile` | agent fallback: send header + sample, return proposed profile + preview |
| GET/POST/PATCH | `/import-profiles` | manage profiles |
| GET | `/imports/:id` | batch with rows and counts per `match_status` |
| PATCH | `/imports/:id/rows/:rowId` | set category/name, exclude, accept planned match, convert to transfer |
| POST | `/imports/:id/commit` | create transactions (and confirm matched planned ones) atomically |
| DELETE | `/imports/:id` | discard draft |

### 14.7 UI

- `/import` page: upload step, profile selection or agent proposal with preview, then the review table.
- Review table: filter chips for *needs category* / *ambiguous* / *matched* / *duplicates*; inline category picker (leaf categories) and name combobox reusing Section 6.1 components; bulk action "apply this category to all rows with the same description".
- Clear counters ("12 matched, 5 need a category") and a disabled commit button until nothing is left unresolved.

### 14.8 V2 milestone and tests

**Milestone 7 — Import.** Implement profiles and script parser, staging tables, matching, dedupe, review UI, commit; then the optional agent fallback last.

Tests must cover: parsing with different delimiters/encodings/date and decimal formats (fixtures of anonymized sample CSVs), debit/credit column handling, exact-name matching and normalization, ambiguous names, unmatched rows blocking commit, duplicate detection across repeated imports and identical same-day rows, planned-transaction reconciliation, atomic commit, and the agent fallback with the API mocked (JSON schema validation, malformed responses rejected).
