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
