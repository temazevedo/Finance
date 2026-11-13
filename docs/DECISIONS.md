# Architecture Decisions

This document records architectural decisions, assumptions, and rationales for the Personal Budgeting & Transaction Tracker project.

## Decision 1: Single Node Process Architecture & Monorepo Structure
- **Context:** The application is a local-first web app serving both the API and client from a single process.
- **Decision:** Use an npm workspaces structure with root `package.json` coordinating `server` and `client`.
- **Rationale:** Keeps dependencies organized while allowing simple single-command scripts (`npm run dev`, `npm run build`, `npm start`, `npm test`).

## Decision 2: SQLite Configuration (`better-sqlite3`)
- **Context:** Synchronous SQLite operations with reliability and performance for local single-process deployment.
- **Decision:** Enable `PRAGMA journal_mode = WAL`, `PRAGMA foreign_keys = ON`, `PRAGMA synchronous = NORMAL`.
- **Rationale:** WAL mode allows concurrent readers while a write is occurring, and foreign keys guarantee referential integrity.

## Decision 3: Partial Unique Indexes for Soft Deletes
- **Context:** Categories and accounts have unique name constraints, but soft-deleting via `archived = 1` could prevent users from reusing a name or creating a replacement.
- **Decision:** Use partial unique indexes with `WHERE archived = 0` (e.g., `CREATE UNIQUE INDEX ux_accounts_active_name ON accounts(name) WHERE archived = 0`).
- **Rationale:** Supports safe archival without blocking re-creation or requiring complex name-mangling.

## Decision 4: Tailwind CSS for Styling
- **Context:** Mobile-first, responsive personal finance UI accessible via browser and Tailscale on mobile devices.
- **Decision:** Adopt Tailwind CSS alongside React.
- **Rationale:** Provides utility classes for clean responsive mobile layouts without heavyweight component library dependencies.

## Decision 5: Dedicated Calendar Date Helpers
- **Context:** JavaScript's `new Date("YYYY-MM-DD")` evaluates as UTC midnight, causing off-by-one errors when formatted or inspected in Portuguese local time (WET/WEST).
- **Decision:** Use string-based arithmetic helpers for calendar dates (`YYYY-MM-DD`), month clamping, and ISO formatting.
- **Rationale:** Guarantees deterministic, timezone-immune date math.

## Decision 6: Onboarding Wizard Persistence via `settings` table
- **Context:** The onboarding wizard must be resumable if the browser closes mid-way (spec section 6.2, step 4 variable budgets are ephemeral between steps).
- **Decision:** Wizard progress persists in two places: recurring items/accounts created during the wizard are normal DB rows (source of truth), while the active step number and the step-4 variable-budgets draft are stored in `settings` (`onboarding_step`, `onboarding_step_data` JSON).
- **Rationale:** Follows the existing key/value settings pattern already specified (`onboarding_completed`, `onboarding_step`) without adding new tables or API surface.

## Decision 7: Budget Rollover Computation Model
- **Context:** Spec 6.5 requires cumulative carryover (`carryover = previous_available - previous_actual`) without a dedicated database table for balances.
- **Decision:** Carryover is computed on demand in `BudgetService.getCarryoverMap(targetMonth)`: for each leaf expense category, iterate month by month from the earliest month holding budgets or confirmed transactions up to the month before the target, accumulating `budget - actual`. A 600-month safety cap bounds the loop.
- **Rationale:** A single SQL pass over two small tables avoids storing derived state that could drift; the app is local-first with a shallow data history, so recomputation is cheap and always consistent.

## Decision 8: Cashflow Projection Semantics
- **Context:** `GET /reports/cashflow` must project planned + actual flows over an arbitrary range.
- **Decision:** Opening balance = active accounts' initial balances + all confirmed flows before `from`. The daily series applies every transaction in `from..to` (both statuses) with sign `+income / -expense`; transfers between own accounts contribute net zero and are excluded from income/expense totals. Projection relies only on stored `planned` transactions (the generator materializes a rolling 60-day horizon); it does not extrapolate beyond generator coverage. Ranges are capped at 370 days.
- **Rationale:** Keeps the projection consistent with account balances by construction and avoids silently inventing occurrences outside what the user confirmed as a plan.

## Decision 9: CSV Export and Settings Keys
- **Context:** Spec section 10 requires browser downloads of the DB backup and a transactions CSV; the settings screen also needs a persisted budget method.
- **Decision:** CSV uses `;` as separator, decimal comma for amounts (pt-PT/Excel friendly), a UTF-8 BOM and quoted fields when values contain separators/quotes. `GET/PUT /api/settings` exposes only user-adjustable known keys (initially `budget_method`); the chosen method becomes the default view on `/budgets` while all methods remain views over the same data.
- **Rationale:** Matches regional spreadsheet conventions out of the box and keeps the settings table contract (`key`/`value`, known keys in AGENT.md section 5.7) without schema changes.

## Decision 10: Auto-Generated Interest Income on Investment Accounts
- **Context:** V1 issue #3: investment accounts need an interest rate (%) with monthly or annual periodicity. The user chose full auto-generation of income transactions (not just a projection).
- **Decision:** Accounts gain `interest_rate` (percent) and `interest_period` (`monthly`/`annual`), only valid when `type='investment'` (cleared automatically if the type changes away). A daily generator pass posts a **confirmed** income transaction `Juros — <conta>` for the most recently *completed* period only: monthly accounts post on the last day of the previous month (`balance × rate/100/12`), annual accounts on Dec 31 (`balance × rate/100`). Balance at period end = initial balance + confirmed movements up to that date. Idempotency comes from an `interest_postings` ledger (`UNIQUE(account_id, period)`); zero-amount periods are recorded to avoid re-evaluation. Interest income attaches to the `Rendimentos de Investimentos` leaf category when present.
- **Rationale:** Only posting fully elapsed periods keeps amounts deterministic (no forecast against a moving balance) and avoids retro-applying today's rate to old history; the ledger table makes daily re-runs free of duplicates. Integer-cents rounding per the project rule.

## Decision 11: Category Delete Semantics
- **Context:** V1 issue #4: categories need create/edit/delete without breaking historical transactions, recurring items or budgets that reference them.
- **Decision:** `DELETE /api/categories/:id` archives (soft delete) the category — cascading to its active children — whenever the category or any descendant is referenced by transactions, recurring items or budgets; only fully unused subtrees are hard-deleted. Editing is guarded: kind changes are blocked while active children keep the current kind, and a category with children cannot be moved below another parent (2-level hierarchy preserved).
- **Rationale:** Archiving keeps history intact (transactions keep resolving their category name), mirrors the existing accounts archive pattern, and avoids destructive reassignment of the user's imported data.

## Decision 12: V2 Import — multer, agent fallback and duplicate safety net
- **Context:** AGENT.md section 14 requires multipart CSV upload, an optional Anthropic-based profile proposal fallback, and dedupe via `import_hash`.
- **Decision:** (1) `multer` (memory storage, 5 MB cap) handles the multipart upload — the only new dependency, kept minimal on purpose. (2) The agent fallback posts ONLY the header plus up to 10 sample rows to the Anthropic Messages API with a tool-forced strict JSON schema; responses are validated with zod and rejected wholesale (`AGENT_MALFORMED`) if malformed; it is opt-in, disabled without `ANTHROPIC_API_KEY`, and the UI warns that sample rows leave the machine. (3) Beyond the spec's `import_hash` check, duplicates are also detected by counting confirmed transactions per (date, amount, normalized description) on the account — the hash alone cannot recognize data imported before V2 (or entered manually), which would silently allow whole duplicate files; with the count check, re-importing the user's legacy CGD export correctly flagged 1108/1147 rows as duplicates.
- **Rationale:** Multipart keeps the spec's API shape; strict schema validation means the agent proposes configuration but can never corrupt profiles; the count-based net makes dedupe robust for all pre-existing data while preserving the occurrence_index semantics for identical same-day rows.
