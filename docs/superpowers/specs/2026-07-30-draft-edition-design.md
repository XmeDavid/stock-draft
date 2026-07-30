# Investment Race — Draft Edition (v2 design)

**Date:** 2026-07-30
**Status:** Supersedes the setup-phase flow of `2026-07-30-investment-race-design.md`. Everything not mentioned here (price service, valuation, daily snapshots, leaderboard/chart, xlsx export, Docker/Dokploy stack, admin password auth) carries over unchanged.

## What changed

Per the user (2026-07-30): instead of the admin entering everyone's
allocations, the race is seeded by a **snake draft**:

- Each participant gets their **own account** (self-registration with a
  shared invite code during a preparation phase).
- Each player drafts **10 picks at $1,000 each** (total $10,000).
- **Unique picks:** once a ticker is drafted, nobody else can take it
  (uniqueness by symbol).
- Draft order is **randomized at draft start**; order snakes:
  A B C D · D C B A · A B C D · …
- Universe: **any Yahoo-resolvable ticker**, explicitly including crypto
  (`BTC-USD`, `ETH-USD`, …). CoinGecko support remains in the price
  service but the draft validates through Yahoo only.
- After the last pick the admin either **starts the race immediately** or
  **schedules a start time**; $1,000-per-pick converts to shares at that
  start instant (not at pick time).
- Currency defaults to **USD** now (user wrote "$"), still configurable.

## Race lifecycle

`registration → drafting → drafted → running`

- **registration:** players register (invite code + username + password).
  Admin sets the invite code and can remove players. Admin "Start draft"
  → shuffles player ids into `draftOrder`, status `drafting`.
- **drafting:** turn-based picking. Turn for pick *i* with *n* players:
  round `floor(i/n)`; position `i % n`, reversed on odd rounds. A player
  picks by submitting a ticker; the server validates it resolves on Yahoo
  and is not already taken, then records a Position (allocation $1,000)
  and advances the pick index. When `picks == n × 10` → status `drafted`.
  **No pick timer:** if someone is unreachable, the admin can pick on
  their behalf (admin console, acts as the on-turn player).
- **drafted:** admin clicks Start now, or sets `scheduledStartAt`; a
  minute-tick cron auto-starts when the time arrives. Start = existing
  `startRace` semantics (fetch all prices, lock quantity + startPrice,
  first snapshot, status `running`) gated on `drafted`.
- **running:** unchanged from v1 (daily snapshots, leaderboard, chart,
  export).

## Data model changes (Prisma)

- `Race`: status default `registration`; currency default `USD`; new
  fields `picksPerPlayer Int @default(10)`, `perPickAmount Decimal
  @default(1000)`, `inviteCode String @default("")`, `draftOrder Json
  @default("[]")` (array of player ids), `currentPickIndex Int
  @default(0)`, `scheduledStartAt DateTime?`.
- `Player`: new `username String @unique`, `passwordHash String`
  (scrypt, `salt:hash` hex). `name` = display name (set at registration,
  defaults to username).
- `Position`: new `pickIndex Int?` (which draft pick created it).
- `Asset.type` values map from Yahoo `instrumentType`:
  CRYPTOCURRENCY→`crypto`, ETF→`etf`, FUTURE→`gold`, else `equity`.

## Auth

- Admin: unchanged (ADMIN_PASSWORD env, `race_admin` cookie, proxy-gated
  `/admin` + `/api/admin/*`).
- Players: `race_player` cookie holding `{playerId}` signed with the same
  `SESSION_SECRET` (generic HMAC token helpers in `src/lib/session.ts`).
  Routes: `POST /api/auth/register` (registration phase only, invite code
  required), `POST /api/auth/login`, `POST /api/auth/logout`. Player
  routes check the cookie in-route (no proxy changes).

## API surface changes

- New public: `GET /api/draft` — race phase, ordered roster, picks so
  far (player, symbol, name, pickIndex), whose turn, and `yourTurn` for
  the requesting session.
- New player: `POST /api/draft/pick {symbol}` — only on your turn.
- New admin: `POST /api/admin/draft/start`, `POST /api/admin/draft/pick
  {symbol}` (on-turn player's behalf), `POST /api/admin/schedule
  {startAt | null}`, `PUT /api/admin/race {inviteCode?, name?,
  currency?}` (registration only).
- Removed (obsolete with the draft): admin players POST, assets
  POST/PUT, positions PUT. Kept: players GET/DELETE (kick during
  registration), assets GET, positions GET.
- `POST /api/admin/start` now requires status `drafted`.

## UI changes

- New pages: `/register`, `/login` (player), both minimal forms.
- Home page is phase-aware: registration → roster + "race is forming";
  drafting/drafted → draft board (snake order, turn highlight, picks
  grid, inline pick form when it's your turn); running → existing
  leaderboard + chart.
- Admin dashboard reworked into phase panels: registration (invite code,
  roster with kick, Start draft), drafting (draft state + pick on
  behalf), drafted (Start now / schedule), running (status).

## Out of scope (unchanged from v1)

Trading/rebalancing after start, pick timers, multiple races,
notifications, per-player emails. Excel export keeps its three sheets.
