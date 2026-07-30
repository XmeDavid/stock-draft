# Investment Race Platform — Design

**Date:** 2026-07-30
**Status:** Approved pending user review

## Purpose

A small self-hosted platform for a friendly investment race. Each participant
gets a virtual 10,000 (EUR by default) and picks a buy-and-hold strategy
(gold, ETFs, crypto, stocks, cash, …). The platform locks in positions at
race start, tracks portfolio values daily using free price APIs, and shows a
public leaderboard with a progress chart. Open-ended — no fixed end date;
bragging rights via highest % gain.

## Constraints

- Hosted on the user's own **Dokploy** instance: one Git repo containing a
  `docker-compose.yml`; Dokploy builds and runs the whole stack. The database
  runs **inside the stack** — no external services.
- Free price data only (no paid API keys).
- Only the admin (single password) can configure; everyone can view.
- Exportable to Excel (.xlsx).

## Architecture

Docker Compose with two services:

| Service | What it is |
|---------|------------|
| `web` | Next.js app (App Router, TypeScript). Serves the public site, the admin area, and API routes. Runs an in-process **node-cron** daily scheduler for snapshots. |
| `db` | Postgres 16 with a named volume for persistence. |

Environment variables (set in Dokploy): `ADMIN_PASSWORD`,
`POSTGRES_PASSWORD` (compose wires `DATABASE_URL` from it), `SESSION_SECRET`,
optional `SNAPSHOT_HOUR` (default 18:00 UTC), `TZ`.

### Price sources

- **Yahoo Finance** (unofficial public endpoints) — stocks, ETFs, gold
  (e.g. `GC=F` futures or a gold ETC ticker), FX.
- **CoinGecko free API** — crypto.
- Each asset row stores its source + symbol; a small price-service module
  hides the differences behind `getPrice(asset): Promise<number>`.
- All prices normalized to the race currency (EUR) via Yahoo FX rates when
  the instrument trades in another currency.

## Data model (Postgres, via Prisma)

- `Race` — singleton: name, currency (default EUR), startingCapital (10000),
  status (`setup` | `running`), startedAt.
- `Player` — name, strategy label, display color.
- `Asset` — symbol, display name, type (`equity|etf|gold|crypto|cash`),
  priceSource (`yahoo|coingecko|none`), sourceId (API symbol/id), quoteCurrency.
- `Position` — playerId, assetId, allocation (amount of starting capital),
  quantity (null until start), startPrice (null until start).
- `Snapshot` — playerId, date, totalValue, plus per-position values JSON;
  `stale` flag when any price fell back to a previous value.

## Flows

### Setup (admin)

- `/admin` behind password login (env `ADMIN_PASSWORD`; signed httpOnly
  cookie via `SESSION_SECRET`).
- While race status is `setup`: CRUD players, assets, and each player's
  allocations (entered as **amounts** of the 10k; UI validates they sum to
  the starting capital, with cash as remainder).

### Start race (admin)

- One "Start race" button. The app fetches live prices at that instant,
  computes `quantity = allocation / price`, stores `startPrice`, flips race
  to `running`, writes the first snapshot (all portfolios = 10,000).
- If any price fetch fails, the start aborts with a clear error — nothing is
  partially locked.

### Daily snapshot

- node-cron fires daily at `SNAPSHOT_HOUR`. Fetch every distinct asset price
  once, compute each player's total, insert one snapshot per player per date
  (idempotent — reruns upsert).
- Per-asset failure → fall back to last known price, mark snapshot `stale`.
- Catch-up on boot: if the app starts and today's (or prior days')
  snapshot is missing while race is running, it records one immediately
  (prior missed days simply remain gaps in the chart).

### Public page (`/`)

- Leaderboard sorted by % gain since start, with current value and delta.
- Line chart (Recharts) of every player's daily value over time.
- Expandable per-player breakdown: positions, quantities, start vs current
  price, per-position gain.
- Live current value: page load triggers a cached (~5 min) price refresh so
  "now" is fresher than the last daily snapshot; the daily snapshot remains
  the historical record.
- Stale-price indicator when applicable.

### Excel export

- Button on the public page → server generates a real `.xlsx` (SheetJS)
  with three sheets: Leaderboard, History (one row per snapshot),
  Positions. Filename includes the date.

## Error handling

- Price service: per-asset try/catch, short retry, fallback to last known
  price + `stale` flag. Never crashes a snapshot run.
- Race start is all-or-nothing (single transaction, aborts on any failed
  fetch).
- Admin routes return 401 without a valid session cookie; login is
  rate-limited (simple in-memory counter).

## Testing

- Unit tests (Vitest): valuation math (allocation → quantity, portfolio
  value, % gain), snapshot idempotency, currency conversion, price-service
  fallback behavior — all with mocked HTTP.
- Smoke test: xlsx export produces a parseable workbook with expected sheets.

## Deployment

- Repo root: `docker-compose.yml` (web + db), `Dockerfile` (multi-stage
  Next.js standalone build), `.env.example`.
- Prisma migrations run automatically on container start
  (`prisma migrate deploy` in the entrypoint).
- In Dokploy: create a Compose application pointed at the repo, set env
  vars, assign a domain to `web` (port 3000). Redeploy on push.

## Out of scope (YAGNI)

- User accounts / per-player logins, trading or rebalancing, multiple
  simultaneous races, notifications, historical backfill of prices before
  race start.
