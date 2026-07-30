# Office Stock League

A friendly investment race for friends or coworkers. Everyone drafts a
portfolio from a shared pool of tickers, prices lock when the race starts, and
the site tracks the winner with live quotes and daily history.

## Game flow

1. **Registration** — the admin sets an invite code. Players create their own
   username and password at `/register`.
2. **Draft** — a randomized snake draft gives every player nine picks at
   $1,000 each. Search autocomplete validates Yahoo Finance tickers and shows
   the company, exchange, quote, and logo before a pick is locked.
3. **MVP** — after the draft, each player privately chooses one drafted pick.
   Its $1,000 allocation scores twice the underlying profit or loss and is
   floored at zero.
4. **Race** — quantities lock at the live starting prices. The public page
   shows standings, sortable holdings, daily and overall returns, player
   profile charts, achievements, weekly matchups, and year-end awards.

## Hosting

The production app runs on Codex Sites:

- Cloudflare D1 stores races, accounts, assets, positions, and snapshots.
- D1 migrations live in `drizzle/` and are applied by Sites.
- Scheduled starts, daily snapshots, and race finishing catch up on the first
  request after their configured time. This avoids depending on a permanently
  running server process.
- Yahoo Finance supplies live quotes, with a five-minute automatic cache and a
  manual refresh control.

Production secrets are managed through Sites rather than committed files:

| Variable | Purpose |
| --- | --- |
| `ADMIN_PASSWORD` | Password for `/admin/login` |
| `SESSION_SECRET` | Cookie-signing secret |
| `SNAPSHOT_HOUR` | UTC hour for daily history, default `18` |

## Local development

Install dependencies and start the Sites-compatible runtime:

```bash
npm install
npm run dev
```

Use an ignored `.dev.vars` file for the three runtime values above. Generate
database migrations after schema changes with `npm run db:generate`.

Validation:

```bash
npm test
npm run lint
npm run build
```
