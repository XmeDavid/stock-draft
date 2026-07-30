# Office Stock League

A friendly investment race for friends or coworkers. Everyone drafts a
portfolio from a shared pool of tickers, prices lock when the race starts, and
the site tracks the winner with live quotes and daily history.

## Game flow

1. **Registration** — the admin sets an invite code. Players create their own
   username and password at `/register`.
2. **Draft** — a randomized snake draft gives every player nine picks at
   $1,000 each. Search validates Yahoo Finance tickers, groups alternate equity
   listings by issuer, and shows the company, exchange, quote, and logo before
   a pick is locked.
3. **MVP** — after the draft, each player privately chooses one drafted pick.
   Its $1,000 allocation scores twice the underlying profit or loss and is
   floored at zero.
4. **Race** — quantities lock at live starting prices. The public page shows
   standings, sortable holdings, daily and overall returns, profile charts,
   achievements, weekly matchups, and year-end awards.

## Deploy on Dokploy

This repository is ready to deploy as a Dokploy **Docker Compose** service:

1. Connect GitHub in Dokploy and create a new Compose service.
2. Select this repository and branch, choose **Docker Compose**, and set the
   Compose Path to `./docker-compose.yml`.
3. Add these service environment variables:

   ```dotenv
   POSTGRES_PASSWORD=use-a-long-url-safe-password
   ADMIN_PASSWORD=choose-an-admin-password
   SESSION_SECRET=generate-a-long-random-string
   SNAPSHOT_HOUR=18
   ```

4. In the Domains tab, attach a domain to the `web` service on port `3000`.
5. Deploy.

Dokploy automatically deploys new pushes to the selected branch. The Compose
stack includes PostgreSQL with a named `race-db` volume, so accounts, drafts,
picks, and history survive app deployments. Database migrations run when the
Next.js server starts.

Dokploy documentation:

- [Connect GitHub](https://docs.dokploy.com/docs/core/github)
- [Docker Compose deployments](https://docs.dokploy.com/docs/core/docker-compose)
- [Domains](https://docs.dokploy.com/docs/core/docker-compose/domains)

## Environment variables

| Variable | Purpose |
| --- | --- |
| `POSTGRES_PASSWORD` | Password shared by the app and bundled PostgreSQL service |
| `DATABASE_URL` | PostgreSQL connection string; Compose constructs this automatically |
| `ADMIN_PASSWORD` | Password for `/admin/login` |
| `SESSION_SECRET` | Cookie-signing secret for admin and player sessions |
| `SNAPSHOT_HOUR` | UTC hour for daily history, default `18` |

Use a URL-safe `POSTGRES_PASSWORD` because Compose places it in
`DATABASE_URL`. A long value containing letters, numbers, `_`, and `-` works
well.

## Local development

The easiest production-like local run is:

```bash
cp .env.example .env
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build
```

Then open `http://localhost:3000`. For native `npm run dev`, run PostgreSQL
separately and change `DATABASE_URL` to use `localhost`.

Validation:

```bash
npm test
npm run lint
npm run build
```

## Operational notes

- Yahoo Finance supplies live quotes, with a short automatic cache and a manual
  refresh control.
- Scheduled starts, daily snapshots, and race finishing catch up on the first
  request after their configured time.
- Keep the web service at one replica. This friends-scale app does not need
  horizontal scaling.
- Back up the `race-db` named volume from Dokploy's Volume Backups area.
