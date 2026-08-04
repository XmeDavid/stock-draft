# Guaranteed snapshots, intraday chart ranges, skeleton loading

## Goals

1. Daily snapshots must happen even with zero traffic (currently a lazy per-request trigger).
2. Zoomable intraday chart views (1D / 1W) without storing intraday data.
3. The home page paints immediately with skeletons and fills in as data arrives (currently blocks on a chain of slow quote fetches).

## 1. Guaranteed snapshots

**Ticker.** `src/instrumentation.ts` (production only, already runs migrations at boot) starts a `setInterval` every 10 minutes calling `advanceRaceClock()`, wrapped in try/catch, with a `globalThis` guard against double registration. The existing per-request trigger stays as a fallback. `advanceRaceClock` already handles scheduled starts, finishes, and snapshot cutoffs, and is idempotent (cutoff check + same-day upsert), so concurrent triggers are harmless.

**Multiple daily refreshes.** `SNAPSHOT_HOUR` is replaced by `SNAPSHOT_HOURS` (comma-separated UTC hours, default `"18"`; `SNAPSHOT_HOUR` still honored for backward compatibility). The cutoff logic finds the most recent passed hour today (or the last hour of yesterday when none has passed yet) and snapshots when the latest snapshot predates it. Earlier hours upsert the same `(player, date)` row — the last run of the day is canonical, earlier runs are a safety net against evening failures. Game mechanics remain strictly daily.

## 2. Intraday chart ranges (compute on demand, store nothing)

**Data sources** (all already used by the app for live quotes):

- Yahoo `v8/finance/chart/{ticker}?interval=5m&range=1d` (1D) or `?interval=30m&range=5d` (1W) for stocks/ETF/gold and FX pairs.
- CoinGecko `/coins/{id}/market_chart?vs_currency={cur}&days=1` (~5-min points) or `days=7` (hourly) for crypto.
- Cash: constant 1.

**Assembly** (`src/lib/intraday.ts`, pure logic separated from fetching for testability):

1. Fetch each unique asset's series (and required FX series) concurrently.
2. Build a fixed time grid over the range (1D: 15-min steps over the last 24 h; 1W: 1-hour steps over the last 7 days).
3. Forward-fill each asset's price onto the grid (crypto ticks 24/7; stocks pause nights/weekends). Before an asset's first point, backfill from its first available price.
4. Per grid point per player: `positionValue(quantity, price, allocation, isMvp)` summed over positions (MVP doubling applies per point).

**Endpoint.** `GET /api/standings/intraday?range=1d|1w` → `{ range, generatedAt, history: [{ date: ISO timestamp, [playerId]: value }] }` — same row shape as the daily history so the chart can reuse its rendering. Only meaningful while the race is `running` (404/409 otherwise).

**Caching & failure.** In-memory cache per range, TTL 5 minutes (mirrors the standings quote cache). Per-asset fetch failure → hold that asset at its last known price (start price as last resort) and mark the response `degraded: true`. Total failure → non-200; the UI falls back to the daily view.

## 3. Range tabs + skeleton loading

**Tabs.** `StandingsSection` gains a range selector — `1D | 1W | All` (default All) — shown only while the race is running. 1D/1W fetch the intraday endpoint (with a small client cache), show a shimmer over the chart while loading, and fall back to All on error. X-axis labels: `HH:mm` for 1D, `Eee HH:mm` for 1W. Highlight, chips, and sorted tooltip behavior are unchanged (tooltip label uses the time formatting).

**Skeletons.** `page.tsx` currently gates the whole page behind `/api/draft`, then `/api/standings` (whose server-side quote fetching takes seconds cold). Changes:

- Fetch `/api/draft` and `/api/standings` in parallel on mount; standings no longer waits for draft. A standings response for a non-season phase is simply ignored.
- Render the page shell immediately: header card renders from nothing (static), then a `Skeleton` variant of the standings banner, chart area, and leaderboard rows (Tailwind `animate-pulse` blocks) occupy the season section until their data arrives. Each section swaps in independently.
- The draft-phase branches keep their current behavior (they're fast — no quote fetching).

## Error handling

- Ticker: errors logged, never crash the process; next tick retries.
- Intraday: per-asset degradation, response-level fallback to daily view.
- Skeletons: fetch failures show the existing error state, not an eternal shimmer.

## Testing

- Unit: cutoff selection for `SNAPSHOT_HOURS` (multiple hours, day rollover, backward compat); intraday grid building, forward/backfill, MVP math, player summing with injected fetchers/clock.
- Existing suites must stay green.
- Browser: skeleton paint order, tab switching with a seeded running race, fallback behavior with providers unreachable.
