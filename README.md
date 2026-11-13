# Orçamento Pessoal — Personal Budgeting & Transaction Tracker

Local-first web app for personal budgeting and transaction tracking (in Portuguese, pt-PT UI). One Node process serves both the REST API and the built React client, backed by a single SQLite file. All amounts are stored and computed as integer cents.

The build spec and architecture decisions live in [`AGENT.md`](AGENT.md) and [`docs/DECISIONS.md`](docs/DECISIONS.md).

## Tech stack

- **Backend:** Node.js (LTS), Express, `better-sqlite3` (synchronous), `zod`
- **Frontend:** Vite, React, React Router, TanStack Query, Tailwind CSS
- **Database:** SQLite (single file `data/app.db`, WAL mode, foreign keys ON)
- **Tests:** Vitest (server-side unit/integration)

## Requirements

- Node.js LTS (tested with Node 20+)
- npm

## Getting started

```bash
npm install

# Development (Vite dev server with proxy + node --watch API server)
npm run dev

# Production: build the client and serve everything from one process
npm run build
npm start            # http://127.0.0.1:3000
```

First run creates and migrates `data/app.db`, seeds the default pt-PT category tree, and the app redirects to the onboarding wizard (`/onboarding`).

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3000` | HTTP port |
| `HOST` | `127.0.0.1` | Bind address (see Tailscale below) |
| `DATABASE_PATH` | `data/app.db` | SQLite file location |

## Tests

```bash
npm test
```

## Backups (data safety)

- **Automatic:** the server creates a timestamped backup in `data/backups/` at startup and once every 24h, keeping the **last 14**.
- **Manual CLI:** `npm run backup` — uses SQLite's online backup API (safe while the server runs).
- **From the browser/phone:** `Definições` → *Descarregar Base de Dados* (`GET /api/settings/backup`) downloads the full SQLite file; *Exportar Transações (CSV)* (`GET /api/settings/export/csv`) downloads all transactions as a `;`-separated, decimal-comma CSV (Excel-friendly).

## Remote access via Tailscale (planned)

Authentication/hardening are intentionally **out of scope for now**. Before exposing the app:

1. Install Tailscale and note the device's tailscale IP/hostname (`tailscale ip -4`).
2. Bind the server to the tailscale interface instead of localhost:
   ```bash
   HOST=$(tailscale ip -4) PORT=3000 npm start
   ```
   or bind to `0.0.0.0` only if the machine is otherwise protected.
3. Implement authentication and rate limiting **before** sharing access, and keep HTTPS termination on your tailscale exit/proxy if needed.

## Project layout

```
/
├── AGENT.md                    # source-of-truth build spec
├── docs/DECISIONS.md           # architecture decision log
├── scripts/dev.js              # runs API + Vite dev server together
├── server/                     # Express API, services, migrations, Vitest tests
│   └── src/
│       ├── index.js            # app bootstrap (serves API + client/dist)
│       ├── db.js, migrate.js   # connection/pragmas, forward-only migrations
│       ├── migrations/         # SQL migrations (applied at startup)
│       ├── routes/ services/ schemas/ utils/
│       └── backup.js           # CLI backup (npm run backup)
├── client/                     # React SPA (pages, components, api client)
└── data/                       # SQLite file + backups (gitignored)
```

## Notes

- Money is never stored as floating point or formatted strings — only integer cents (`*_cents`).
- Dates are ISO `YYYY-MM-DD` text; all calendar math goes through timezone-safe string helpers to avoid WET/WEST off-by-one errors.
- Upcoming (V2): bank statement CSV import with import profiles; optional agent-assisted profile proposal.
