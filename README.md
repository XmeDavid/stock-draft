# Race to 1 Mil

A friendly investment race for a group of friends. Everyone drafts a portfolio
from a shared pool of tickers, the picks lock at the price they had when the
race starts, and the site tracks who's winning with daily price snapshots.

## How it works

1. **Registration** — the admin sets an invite code and shares it. Friends
   self-register at `/register` (name, username, password, invite code). No
   admin data entry: players own their accounts and log in at `/login`.
2. **Draft** — the admin starts the draft, which closes registration and locks
   a randomly shuffled pick order. It's a **snake draft**: 10 picks per player,
   **$1,000 per pick** (a $10,000 starting portfolio each). Players take their
   turns at `/` (the draft board shows whose turn it is); the admin can pick on
   someone's behalf if needed.
   Any ticker Yahoo Finance can resolve is allowed — equities, ETFs, and crypto
   in Yahoo's `BTC-USD` / `ETH-USD` form. A ticker already drafted by anyone is
   off the board.
3. **Race** — after the last pick, the admin starts the race immediately or
   schedules a start time. At start, every position's quantity is fixed at the
   then-current price and the leaderboard/chart go live. Buy and hold: no
   trading after the start.

## Deploy on Dokploy

1. Create a **Compose** application pointing at this repo (compose file:
   `docker-compose.yml`).
2. Set environment variables: `ADMIN_PASSWORD`, `SESSION_SECRET` (long random
   string), `POSTGRES_PASSWORD`, optionally `SNAPSHOT_HOUR` (UTC hour, default
   18). All three are required — compose refuses to start without them.
3. Assign a domain to the `web` service, port 3000.
4. Deploy. Open `/admin`, log in, set the invite code and share it; friends
   register at `/register`; when everyone's in, hit **Start draft**; after the
   last pick, **Start race now** or schedule a start time.

The container runs `prisma migrate deploy` on boot, so a fresh database is set
up automatically.

Dokploy's proxy reaches the `web` service over the docker network, so no
published host port is needed for routing. `web` therefore binds its port to
loopback only (`127.0.0.1:3000:3000`) — that mapping exists for local
`docker compose up` testing, and keeps the app off the server's public
interface, where it would otherwise be reachable over plain HTTP (credentials
in the clear) and could collide with anything else holding port 3000.

## Local dev

The compose `db` service deliberately publishes no host port (it is only
reachable from `web`), so for local dev run a throwaway Postgres yourself:

    docker run -d --name race-db -p 5432:5432 \
      -e POSTGRES_USER=race -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=race \
      postgres:16-alpine
    cp .env.example .env   # DATABASE_URL=postgresql://race:dev@localhost:5432/race
    npx prisma migrate dev
    npm run dev

To bring the compose stack up locally instead, export the required variables
first (there are no defaults):

    export POSTGRES_PASSWORD=dev ADMIN_PASSWORD=dev SESSION_SECRET=dev-secret
    docker compose up --build

Tests: `npm test`. Production build check: `npm run build`.

## Notes

- **Prices**: Yahoo Finance (equities, ETFs, and crypto such as `BTC-USD`) with
  a CoinGecko path retained for assets configured with that source. Free, no
  API keys. Non-USD quotes are converted to the race currency.
- **Snapshots**: a daily snapshot runs at `SNAPSHOT_HOUR` UTC inside the web
  container, plus one on boot, so a restart or a missed day is caught up. If a
  price can't be fetched, the last known price is reused and the row is flagged
  stale.
- **Auto-start**: a minute-tick cron flips a scheduled race to running once its
  start time arrives, so nobody has to be at a keyboard.
- **Single replica**: cron runs in-process, so do not scale the `web` service
  beyond 1 replica — extra replicas duplicate the snapshot and auto-start ticks.
- **Export**: the **Export .xlsx** button on the homepage (`/api/export`) —
  standings, daily history, and every position.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string (set by compose) |
| `POSTGRES_PASSWORD` | Postgres password, used by both `db` and `DATABASE_URL` (required, no default) |
| `ADMIN_PASSWORD` | Password for `/admin/login` |
| `SESSION_SECRET` | Signing secret for admin and player sessions |
| `SNAPSHOT_HOUR` | UTC hour for the daily snapshot (default `18`) |
| `TZ` | Kept at `UTC` so cron hours are unambiguous |
