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
