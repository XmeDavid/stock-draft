# Investment Race Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A self-hosted (Dokploy/Docker Compose) investment-race platform: virtual 10k buy-and-hold portfolios, daily price snapshots from free APIs, public leaderboard + chart, password-protected admin, xlsx export.

**Architecture:** One Next.js (App Router, TS) container serving public site, admin, and API routes, with an in-process node-cron daily snapshot job; one Postgres container with a volume. Prisma for data access. All price fetching behind a single price-service module.

**Tech Stack:** Next.js 15, TypeScript, Prisma + Postgres 16, Vitest, node-cron, xlsx (SheetJS), Recharts, iron-session-style signed cookie (hand-rolled HMAC), Docker Compose.

## Global Constraints

- Currency: race currency default **EUR**; starting capital **10000**.
- Race status values: exactly `setup` | `running`.
- Asset types: exactly `equity | etf | gold | crypto | cash`.
- Price sources: exactly `yahoo | coingecko | none`.
- Env vars: `ADMIN_PASSWORD`, `SESSION_SECRET`, `DATABASE_URL`, `SNAPSHOT_HOUR` (default `18`, UTC), `TZ`.
- All money values stored as `Decimal` in Postgres, handled as `number` in app code (amateur-scale amounts; precision loss acceptable).
- Snapshots are idempotent per (playerId, date) — reruns upsert.
- Race start is all-or-nothing: any failed price fetch aborts the whole start.
- Tests: Vitest, no real network calls — `fetch` is always mocked.
- Commits after every task; conventional-commit style messages.

## File Structure

```
docker-compose.yml
Dockerfile
docker-entrypoint.sh
.env.example
prisma/schema.prisma
src/lib/db.ts               # Prisma client singleton
src/lib/prices.ts           # getPrice(asset), getPrices(assets) — yahoo/coingecko/FX
src/lib/valuation.ts        # pure math: quantities, portfolio value, % gain
src/lib/snapshot.ts         # runSnapshot(date) — fetch prices, upsert snapshots
src/lib/startRace.ts        # lock positions transactionally
src/lib/session.ts          # signCookie/verifyCookie (HMAC), requireAdmin helper
src/lib/export.ts           # buildWorkbook() -> xlsx Buffer
src/instrumentation.ts      # starts node-cron + boot catch-up (Next.js hook)
src/app/page.tsx            # public leaderboard + chart
src/app/api/export/route.ts
src/app/api/admin/login/route.ts
src/app/api/admin/players/route.ts     # + [id] route
src/app/api/admin/assets/route.ts      # + [id] route
src/app/api/admin/positions/route.ts
src/app/api/admin/start/route.ts
src/app/admin/page.tsx      # admin UI (client component)
src/app/admin/login/page.tsx
tests/valuation.test.ts
tests/prices.test.ts
tests/session.test.ts
tests/export.test.ts
tests/snapshot.test.ts      # uses mocked prisma
```

---

### Task 1: Scaffold Next.js app, Prisma schema, dev tooling

**Files:**
- Create: entire Next.js scaffold, `prisma/schema.prisma`, `src/lib/db.ts`, `vitest.config.ts`, `.env.example`

**Interfaces:**
- Produces: Prisma models `Race`, `Player`, `Asset`, `Position`, `Snapshot` (fields below — all later tasks depend on these exact names); `prisma` client export from `src/lib/db.ts`.

- [ ] **Step 1: Scaffold**

```bash
cd /Users/xmedavid/race_to_1_mil
npx create-next-app@latest . --ts --app --tailwind --eslint --no-src-dir --import-alias "@/*" --use-npm --yes
# create-next-app refuses non-empty dirs: if so, scaffold in a temp dir and move files in, preserving docs/ and .git/
mkdir -p src && git mv app src/app 2>/dev/null || mv app src/app
```

Note: we DO want `src/` layout. If the scaffold created `app/` at root, move it under `src/` and Next picks it up automatically.

- [ ] **Step 2: Install deps**

```bash
npm i @prisma/client node-cron xlsx recharts
npm i -D prisma vitest @types/node-cron
```

- [ ] **Step 3: Prisma schema**

`prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Race {
  id              Int      @id @default(1)
  name            String   @default("Race to 1 Mil")
  currency        String   @default("EUR")
  startingCapital Decimal  @default(10000)
  status          String   @default("setup") // setup | running
  startedAt       DateTime?
}

model Player {
  id        Int        @id @default(autoincrement())
  name      String
  strategy  String     @default("")
  color     String     @default("#8884d8")
  positions Position[]
  snapshots Snapshot[]
}

model Asset {
  id            Int        @id @default(autoincrement())
  symbol        String     @unique   // display symbol, e.g. "VWCE.DE", "BTC", "GOLD", "CASH"
  name          String
  type          String     // equity | etf | gold | crypto | cash
  priceSource   String     // yahoo | coingecko | none
  sourceId      String     // yahoo ticker or coingecko id; "" for cash
  quoteCurrency String     @default("EUR")
  positions     Position[]
}

model Position {
  id         Int      @id @default(autoincrement())
  player     Player   @relation(fields: [playerId], references: [id], onDelete: Cascade)
  playerId   Int
  asset      Asset    @relation(fields: [assetId], references: [id], onDelete: Cascade)
  assetId    Int
  allocation Decimal            // amount of starting capital, in race currency
  quantity   Decimal?           // null until race start
  startPrice Decimal?           // null until race start, in race currency
  @@unique([playerId, assetId])
}

model Snapshot {
  id        Int      @id @default(autoincrement())
  player    Player   @relation(fields: [playerId], references: [id], onDelete: Cascade)
  playerId  Int
  date      DateTime @db.Date
  totalValue Decimal
  breakdown Json     // [{assetId, symbol, quantity, price, value}]
  stale     Boolean  @default(false)
  @@unique([playerId, date])
}
```

- [ ] **Step 4: Prisma client singleton**

`src/lib/db.ts`:

```ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

- [ ] **Step 5: Vitest config + npm scripts**

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: { environment: "node" },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
```

Add to `package.json` scripts: `"test": "vitest run"`.

`.env.example`:

```
DATABASE_URL=postgresql://race:changeme@db:5432/race
ADMIN_PASSWORD=changeme
SESSION_SECRET=change-this-to-a-long-random-string
SNAPSHOT_HOUR=18
TZ=UTC
```

- [ ] **Step 6: Verify build passes**

Run: `npx prisma generate && npm run build`
Expected: build succeeds. (No DB needed for generate/build.)

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: scaffold next.js app with prisma schema"
```

---

### Task 2: Valuation module (pure math, TDD)

**Files:**
- Create: `src/lib/valuation.ts`, `tests/valuation.test.ts`

**Interfaces:**
- Produces:
  - `computeQuantity(allocation: number, price: number): number`
  - `portfolioValue(positions: {quantity: number; price: number}[]): number`
  - `percentGain(current: number, starting: number): number`

- [ ] **Step 1: Write failing tests**

`tests/valuation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeQuantity, portfolioValue, percentGain } from "@/lib/valuation";

describe("computeQuantity", () => {
  it("divides allocation by price", () => {
    expect(computeQuantity(5000, 100)).toBe(50);
  });
  it("handles fractional quantities (crypto)", () => {
    expect(computeQuantity(1000, 30000)).toBeCloseTo(0.033333, 5);
  });
  it("throws on zero or negative price", () => {
    expect(() => computeQuantity(1000, 0)).toThrow();
    expect(() => computeQuantity(1000, -5)).toThrow();
  });
});

describe("portfolioValue", () => {
  it("sums quantity * price", () => {
    expect(
      portfolioValue([
        { quantity: 50, price: 110 },
        { quantity: 2, price: 1000 },
      ])
    ).toBe(7500);
  });
  it("is 0 for empty portfolio", () => {
    expect(portfolioValue([])).toBe(0);
  });
});

describe("percentGain", () => {
  it("computes gain", () => {
    expect(percentGain(11000, 10000)).toBeCloseTo(10);
  });
  it("computes loss", () => {
    expect(percentGain(9000, 10000)).toBeCloseTo(-10);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- tests/valuation.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement**

`src/lib/valuation.ts`:

```ts
export function computeQuantity(allocation: number, price: number): number {
  if (price <= 0) throw new Error(`Invalid price: ${price}`);
  return allocation / price;
}

export function portfolioValue(
  positions: { quantity: number; price: number }[]
): number {
  return positions.reduce((sum, p) => sum + p.quantity * p.price, 0);
}

export function percentGain(current: number, starting: number): number {
  return ((current - starting) / starting) * 100;
}
```

- [ ] **Step 4: Run tests — pass**

Run: `npm test -- tests/valuation.test.ts` → PASS

- [ ] **Step 5: Commit**

```bash
git add tests/valuation.test.ts src/lib/valuation.ts
git commit -m "feat: valuation math module"
```

---

### Task 3: Price service (yahoo + coingecko + FX, mocked-fetch TDD)

**Files:**
- Create: `src/lib/prices.ts`, `tests/prices.test.ts`

**Interfaces:**
- Consumes: `Asset`-shaped objects `{ priceSource, sourceId, quoteCurrency, type }`.
- Produces:
  - `getPrice(asset: PriceAsset, raceCurrency: string): Promise<number>` — price in race currency; `1` for cash-in-race-currency; throws on failure.
  - `getPrices(assets: PriceAsset[], raceCurrency: string): Promise<Map<string, PriceResult>>` keyed by `sourceKey(asset)`; `PriceResult = { price: number } | { error: string }` — never throws.
  - `sourceKey(asset: PriceAsset): string` = `` `${priceSource}:${sourceId}` ``
  - `type PriceAsset = { priceSource: string; sourceId: string; quoteCurrency: string; type: string }`

- [ ] **Step 1: Write failing tests**

`tests/prices.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getPrice, getPrices, sourceKey } from "@/lib/prices";

const yahooResponse = (price: number) => ({
  ok: true,
  json: async () => ({
    chart: { result: [{ meta: { regularMarketPrice: price } }] },
  }),
});
const geckoResponse = (id: string, cur: string, price: number) => ({
  ok: true,
  json: async () => ({ [id]: { [cur.toLowerCase()]: price } }),
});

const mockFetch = vi.fn();
beforeEach(() => { vi.stubGlobal("fetch", mockFetch); mockFetch.mockReset(); });
afterEach(() => { vi.unstubAllGlobals(); });

const eurEtf = { priceSource: "yahoo", sourceId: "VWCE.DE", quoteCurrency: "EUR", type: "etf" };
const usdGold = { priceSource: "yahoo", sourceId: "GC=F", quoteCurrency: "USD", type: "gold" };
const btc = { priceSource: "coingecko", sourceId: "bitcoin", quoteCurrency: "EUR", type: "crypto" };
const cash = { priceSource: "none", sourceId: "", quoteCurrency: "EUR", type: "cash" };

describe("getPrice", () => {
  it("returns yahoo price directly when quote currency = race currency", async () => {
    mockFetch.mockResolvedValueOnce(yahooResponse(105.5));
    expect(await getPrice(eurEtf, "EUR")).toBe(105.5);
  });
  it("converts via FX when quote currency differs", async () => {
    // first call: GC=F price in USD; second call: EURUSD=X rate
    mockFetch
      .mockResolvedValueOnce(yahooResponse(2000))
      .mockResolvedValueOnce(yahooResponse(1.25)); // 1 EUR = 1.25 USD
    expect(await getPrice(usdGold, "EUR")).toBeCloseTo(1600);
    expect(mockFetch.mock.calls[1][0]).toContain("EURUSD=X");
  });
  it("asks coingecko in race currency directly", async () => {
    mockFetch.mockResolvedValueOnce(geckoResponse("bitcoin", "eur", 60000));
    expect(await getPrice(btc, "EUR")).toBe(60000);
    expect(String(mockFetch.mock.calls[0][0])).toContain("vs_currencies=eur");
  });
  it("returns 1 for cash without fetching", async () => {
    expect(await getPrice(cash, "EUR")).toBe(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    await expect(getPrice(eurEtf, "EUR")).rejects.toThrow();
  });
});

describe("getPrices", () => {
  it("collects successes and errors without throwing", async () => {
    mockFetch
      .mockResolvedValueOnce(yahooResponse(100))
      .mockRejectedValueOnce(new Error("network down"));
    const res = await getPrices([eurEtf, btc], "EUR");
    expect(res.get(sourceKey(eurEtf))).toEqual({ price: 100 });
    expect(res.get(sourceKey(btc))).toHaveProperty("error");
  });
});
```

- [ ] **Step 2: Run to verify fail** → module not found.

- [ ] **Step 3: Implement**

`src/lib/prices.ts`:

```ts
export type PriceAsset = {
  priceSource: string;
  sourceId: string;
  quoteCurrency: string;
  type: string;
};
export type PriceResult = { price: number } | { error: string };

const UA = { headers: { "User-Agent": "Mozilla/5.0 (race-to-1-mil)" } };

export function sourceKey(a: PriceAsset): string {
  return `${a.priceSource}:${a.sourceId}`;
}

async function yahooQuote(ticker: string): Promise<number> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`;
  const res = await fetch(url, UA);
  if (!res.ok) throw new Error(`yahoo ${ticker}: HTTP ${res.status}`);
  const data = await res.json();
  const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
  if (typeof price !== "number") throw new Error(`yahoo ${ticker}: no price in response`);
  return price;
}

async function fxRate(from: string, to: string): Promise<number> {
  if (from === to) return 1;
  // Yahoo FX ticker "EURUSD=X" = how many USD per 1 EUR.
  return yahooQuote(`${to}${from}=X`).then((r) => 1 / r);
}

async function coingeckoQuote(id: string, currency: string): Promise<number> {
  const cur = currency.toLowerCase();
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=${cur}`;
  const res = await fetch(url, UA);
  if (!res.ok) throw new Error(`coingecko ${id}: HTTP ${res.status}`);
  const data = await res.json();
  const price = data?.[id]?.[cur];
  if (typeof price !== "number") throw new Error(`coingecko ${id}: no price`);
  return price;
}

export async function getPrice(asset: PriceAsset, raceCurrency: string): Promise<number> {
  if (asset.priceSource === "none") return 1; // cash: 1 unit = 1 currency unit
  if (asset.priceSource === "coingecko") {
    return coingeckoQuote(asset.sourceId, raceCurrency);
  }
  const raw = await yahooQuote(asset.sourceId);
  const rate = await fxRate(asset.quoteCurrency, raceCurrency);
  return raw * rate;
}

export async function getPrices(
  assets: PriceAsset[],
  raceCurrency: string
): Promise<Map<string, PriceResult>> {
  const out = new Map<string, PriceResult>();
  for (const a of assets) {
    if (out.has(sourceKey(a))) continue;
    try {
      out.set(sourceKey(a), { price: await getPrice(a, raceCurrency) });
    } catch (e) {
      out.set(sourceKey(a), { error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}
```

Note on FX test expectation: `fxRate("USD","EUR")` fetches `EURUSD=X` (USD per EUR = 1.25) and returns 1/1.25 = 0.8; 2000 × 0.8 = 1600. Matches test.

- [ ] **Step 4: Run tests — pass**: `npm test -- tests/prices.test.ts`

- [ ] **Step 5: Commit** — `feat: price service with yahoo/coingecko + FX conversion`

---

### Task 4: Session/auth module (TDD) + login API + middleware

**Files:**
- Create: `src/lib/session.ts`, `tests/session.test.ts`, `src/app/api/admin/login/route.ts`, `src/middleware.ts`

**Interfaces:**
- Produces:
  - `signSession(secret: string): string` — `payload.hmac` token
  - `verifySession(token: string | undefined, secret: string): boolean`
  - Cookie name constant `SESSION_COOKIE = "race_admin"`
  - `POST /api/admin/login` `{password}` → sets cookie, 200; wrong → 401
  - `src/middleware.ts` protects `/admin` (except `/admin/login`) and `/api/admin/*` (except login), redirect/401 respectively.

- [ ] **Step 1: Failing tests**

`tests/session.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { signSession, verifySession } from "@/lib/session";

describe("session tokens", () => {
  it("round-trips a valid token", () => {
    const t = signSession("secret1");
    expect(verifySession(t, "secret1")).toBe(true);
  });
  it("rejects wrong secret", () => {
    const t = signSession("secret1");
    expect(verifySession(t, "other")).toBe(false);
  });
  it("rejects tampered/garbage/undefined", () => {
    expect(verifySession("garbage", "s")).toBe(false);
    expect(verifySession(undefined, "s")).toBe(false);
    const t = signSession("s");
    expect(verifySession(t + "x", "s")).toBe(false);
  });
});
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement**

`src/lib/session.ts`:

```ts
import { createHmac, timingSafeEqual } from "crypto";

export const SESSION_COOKIE = "race_admin";

function hmac(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function signSession(secret: string): string {
  const payload = Buffer.from(JSON.stringify({ admin: true, iat: Date.now() })).toString("base64url");
  return `${payload}.${hmac(payload, secret)}`;
}

export function verifySession(token: string | undefined, secret: string): boolean {
  if (!token) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  const expected = hmac(payload, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

- [ ] **Step 4: Run → pass.**

- [ ] **Step 5: Login route + middleware**

`src/app/api/admin/login/route.ts`:

```ts
import { NextResponse } from "next/server";
import { signSession, SESSION_COOKIE } from "@/lib/session";

const attempts = new Map<string, { count: number; ts: number }>();

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for") ?? "local";
  const a = attempts.get(ip) ?? { count: 0, ts: Date.now() };
  if (Date.now() - a.ts > 15 * 60_000) { a.count = 0; a.ts = Date.now(); }
  if (a.count >= 10) return NextResponse.json({ error: "Too many attempts" }, { status: 429 });

  const { password } = await req.json();
  if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD) {
    a.count++; attempts.set(ip, a);
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, signSession(process.env.SESSION_SECRET!), {
    httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
```

`src/middleware.ts` (middleware runs on edge runtime where `crypto` module works via Node APIs in Next 15 middleware only with `runtime: "nodejs"`; to keep it simple, verify with Web Crypto):

```ts
import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

async function verifyEdge(token: string | undefined, secret: string): Promise<boolean> {
  if (!token) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const expected = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return expected === sig;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isLogin = pathname === "/admin/login" || pathname === "/api/admin/login";
  if (isLogin) return NextResponse.next();

  const ok = await verifyEdge(
    req.cookies.get(SESSION_COOKIE)?.value,
    process.env.SESSION_SECRET ?? ""
  );
  if (ok) return NextResponse.next();

  if (pathname.startsWith("/api/"))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.redirect(new URL("/admin/login", req.url));
}

export const config = { matcher: ["/admin/:path*", "/admin", "/api/admin/:path*"] };
```

IMPORTANT: `src/lib/session.ts` must not be imported into middleware beyond the `SESSION_COOKIE` constant (Node `crypto` import would break edge bundling if the runtime is edge). Keep the constant export at the top; if bundling complains, move `SESSION_COOKIE` to `src/lib/constants.ts` and update imports in both files.

- [ ] **Step 6: Build check** — `npm run build` → succeeds.

- [ ] **Step 7: Commit** — `feat: admin session auth with login route and middleware`

---

### Task 5: Admin CRUD APIs (players, assets, positions)

**Files:**
- Create: `src/app/api/admin/players/route.ts`, `src/app/api/admin/players/[id]/route.ts`, `src/app/api/admin/assets/route.ts`, `src/app/api/admin/assets/[id]/route.ts`, `src/app/api/admin/positions/route.ts`, `src/lib/race.ts`

**Interfaces:**
- Consumes: `prisma` from `@/lib/db`.
- Produces:
  - `getRace()` in `src/lib/race.ts`: upserts+returns the singleton Race (id=1).
  - `GET/POST /api/admin/players`, `PUT/DELETE /api/admin/players/:id`
  - `GET/POST /api/admin/assets`, `PUT/DELETE /api/admin/assets/:id`
  - `GET /api/admin/positions?playerId=` and `PUT /api/admin/positions` with body `{playerId, positions: [{assetId, allocation}]}` (replaces that player's positions).
  - All mutating routes reject with 409 if race status is `running`.

- [ ] **Step 1: `src/lib/race.ts`**

```ts
import { prisma } from "@/lib/db";

export async function getRace() {
  return prisma.race.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}

export async function assertSetup() {
  const race = await getRace();
  if (race.status !== "setup") {
    const err = new Error("Race already started — configuration is locked");
    (err as Error & { status?: number }).status = 409;
    throw err;
  }
  return race;
}
```

- [ ] **Step 2: Players routes**

`src/app/api/admin/players/route.ts`:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { assertSetup } from "@/lib/race";

export async function GET() {
  const players = await prisma.player.findMany({
    include: { positions: { include: { asset: true } } },
    orderBy: { id: "asc" },
  });
  return NextResponse.json(players);
}

export async function POST(req: Request) {
  try {
    await assertSetup();
    const { name, strategy = "", color = "#8884d8" } = await req.json();
    if (!name?.trim()) return NextResponse.json({ error: "Name required" }, { status: 400 });
    const player = await prisma.player.create({ data: { name: name.trim(), strategy, color } });
    return NextResponse.json(player, { status: 201 });
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
```

`src/app/api/admin/players/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { assertSetup } from "@/lib/race";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await assertSetup();
    const { id } = await params;
    const { name, strategy, color } = await req.json();
    const player = await prisma.player.update({
      where: { id: Number(id) },
      data: { name, strategy, color },
    });
    return NextResponse.json(player);
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await assertSetup();
    const { id } = await params;
    await prisma.player.delete({ where: { id: Number(id) } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
```

- [ ] **Step 3: Assets routes** — same shape as players. POST body `{symbol, name, type, priceSource, sourceId, quoteCurrency}`; validate `type` ∈ `equity|etf|gold|crypto|cash`, `priceSource` ∈ `yahoo|coingecko|none`. On POST, if `priceSource !== "none"`, verify the symbol resolves by calling `getPrice` once and return 400 with the fetch error if it fails (catches typos at entry time). PUT/DELETE mirror players' `[id]` routes.

`src/app/api/admin/assets/route.ts`:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { assertSetup, getRace } from "@/lib/race";
import { getPrice } from "@/lib/prices";

const TYPES = ["equity", "etf", "gold", "crypto", "cash"];
const SOURCES = ["yahoo", "coingecko", "none"];

export async function GET() {
  return NextResponse.json(await prisma.asset.findMany({ orderBy: { symbol: "asc" } }));
}

export async function POST(req: Request) {
  try {
    const race = await assertSetup();
    const { symbol, name, type, priceSource, sourceId = "", quoteCurrency = race.currency } = await req.json();
    if (!symbol?.trim() || !name?.trim()) return NextResponse.json({ error: "Symbol and name required" }, { status: 400 });
    if (!TYPES.includes(type)) return NextResponse.json({ error: `type must be one of ${TYPES.join(", ")}` }, { status: 400 });
    if (!SOURCES.includes(priceSource)) return NextResponse.json({ error: `priceSource must be one of ${SOURCES.join(", ")}` }, { status: 400 });
    if (priceSource !== "none") {
      try {
        await getPrice({ priceSource, sourceId, quoteCurrency, type }, race.currency);
      } catch (e) {
        return NextResponse.json({ error: `Price check failed: ${(e as Error).message}` }, { status: 400 });
      }
    }
    const asset = await prisma.asset.create({
      data: { symbol: symbol.trim().toUpperCase(), name: name.trim(), type, priceSource, sourceId, quoteCurrency },
    });
    return NextResponse.json(asset, { status: 201 });
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
```

`src/app/api/admin/assets/[id]/route.ts` — copy the players `[id]` route, swapping `prisma.player` → `prisma.asset` and the PUT data fields to `{symbol, name, type, priceSource, sourceId, quoteCurrency}`.

- [ ] **Step 4: Positions route**

`src/app/api/admin/positions/route.ts`:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { assertSetup } from "@/lib/race";

export async function PUT(req: Request) {
  try {
    const race = await assertSetup();
    const { playerId, positions } = await req.json() as
      { playerId: number; positions: { assetId: number; allocation: number }[] };
    const total = positions.reduce((s, p) => s + p.allocation, 0);
    if (total > Number(race.startingCapital) + 0.01)
      return NextResponse.json(
        { error: `Allocations (${total}) exceed starting capital (${race.startingCapital})` },
        { status: 400 });
    await prisma.$transaction([
      prisma.position.deleteMany({ where: { playerId } }),
      prisma.position.createMany({
        data: positions.filter((p) => p.allocation > 0)
          .map((p) => ({ playerId, assetId: p.assetId, allocation: p.allocation })),
      }),
    ]);
    const saved = await prisma.position.findMany({ where: { playerId }, include: { asset: true } });
    return NextResponse.json(saved);
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
```

Under-allocation is allowed and treated as implicit uninvested cash at start (Task 6 handles it).

- [ ] **Step 5: Build check** — `npm run build` → succeeds.

- [ ] **Step 6: Commit** — `feat: admin CRUD APIs for players, assets, positions`

---

### Task 6: Race start (transactional lock-in)

**Files:**
- Create: `src/lib/startRace.ts`, `src/app/api/admin/start/route.ts`, `tests/startRace.test.ts`

**Interfaces:**
- Consumes: `getPrices`, `sourceKey` from `@/lib/prices`; `computeQuantity` from `@/lib/valuation`; `prisma`.
- Produces:
  - `startRace(deps?: { db?: typeof prisma; fetchPrices?: typeof getPrices; now?: Date }): Promise<void>` — throws `Error` with `.status = 409` if already running / no players; `.status = 502` if any price fetch failed (message lists which).
  - `POST /api/admin/start` → 200 `{ok: true}` or error JSON with that status.
  - Ensures a `CASH` asset exists (`priceSource: "none"`) and adds an implicit cash position for any player whose allocations sum below starting capital.
  - Writes the first snapshot for every player, dated `now`, `totalValue` = actual computed value from locked prices (≈ starting capital by construction).

- [ ] **Step 1: Failing test (mocked prisma + prices)**

`tests/startRace.test.ts` — inject fakes via the `deps` parameter:

```ts
import { describe, it, expect, vi } from "vitest";
import { startRace } from "@/lib/startRace";

function makeDb(overrides: Record<string, unknown> = {}) {
  const positionsStore: Record<number, { quantity: number; startPrice: number }> = {};
  const snapshots: unknown[] = [];
  const db = {
    race: {
      upsert: vi.fn(async () => ({ id: 1, status: "setup", currency: "EUR", startingCapital: 10000 })),
      update: vi.fn(async () => ({})),
    },
    player: {
      findMany: vi.fn(async () => [
        {
          id: 1, name: "Ana",
          positions: [
            { id: 11, assetId: 5, allocation: 6000, asset: { id: 5, symbol: "VWCE", priceSource: "yahoo", sourceId: "VWCE.DE", quoteCurrency: "EUR", type: "etf" } },
          ],
        },
      ]),
    },
    asset: { upsert: vi.fn(async () => ({ id: 99, symbol: "CASH", priceSource: "none", sourceId: "", quoteCurrency: "EUR", type: "cash" })) },
    position: {
      update: vi.fn(async ({ where, data }: { where: { id: number }; data: { quantity: number; startPrice: number } }) => { positionsStore[where.id] = data; return data; }),
      create: vi.fn(async ({ data }: { data: unknown }) => data),
    },
    snapshot: { upsert: vi.fn(async ({ create }: { create: unknown }) => { snapshots.push(create); return create; }) },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
    _positionsStore: positionsStore,
    _snapshots: snapshots,
    ...overrides,
  };
  return db;
}

describe("startRace", () => {
  it("locks quantities and start prices from fetched prices", async () => {
    const db = makeDb();
    const fetchPrices = vi.fn(async () => new Map([["yahoo:VWCE.DE", { price: 120 }]]));
    await startRace({ db: db as never, fetchPrices: fetchPrices as never, now: new Date("2026-07-30") });
    expect(db._positionsStore[11]).toEqual({ quantity: 50, startPrice: 120 });
    // 4000 under-allocated -> implicit cash position created
    expect(db.position.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ allocation: 4000, quantity: 4000, startPrice: 1 }) })
    );
    expect(db.race.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "running" }) })
    );
    expect(db._snapshots).toHaveLength(1);
  });

  it("aborts entirely when any price fetch failed", async () => {
    const db = makeDb();
    const fetchPrices = vi.fn(async () => new Map([["yahoo:VWCE.DE", { error: "HTTP 500" }]]));
    await expect(
      startRace({ db: db as never, fetchPrices: fetchPrices as never })
    ).rejects.toThrow(/VWCE/);
    expect(db.race.update).not.toHaveBeenCalled();
  });

  it("refuses when race already running", async () => {
    const db = makeDb({
      race: { upsert: vi.fn(async () => ({ id: 1, status: "running", currency: "EUR", startingCapital: 10000 })), update: vi.fn() },
    });
    await expect(startRace({ db: db as never })).rejects.toThrow(/already/i);
  });
});
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement**

`src/lib/startRace.ts`:

```ts
import { prisma } from "@/lib/db";
import { getPrices, sourceKey, type PriceAsset } from "@/lib/prices";
import { computeQuantity, portfolioValue } from "@/lib/valuation";

type Deps = { db?: typeof prisma; fetchPrices?: typeof getPrices; now?: Date };

function httpError(message: string, status: number): Error {
  const e = new Error(message);
  (e as Error & { status?: number }).status = status;
  return e;
}

export async function startRace({ db = prisma, fetchPrices = getPrices, now = new Date() }: Deps = {}) {
  const race = await db.race.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  if (race.status !== "setup") throw httpError("Race already started", 409);

  const players = await db.player.findMany({ include: { positions: { include: { asset: true } } } });
  if (players.length === 0) throw httpError("No players configured", 409);

  const assets = players.flatMap((p) => p.positions.map((pos) => pos.asset as PriceAsset & { symbol: string }));
  const prices = await fetchPrices(assets, race.currency);

  const failures = assets.filter((a) => {
    const r = prices.get(sourceKey(a));
    return !r || "error" in r;
  });
  if (failures.length > 0) {
    const detail = failures.map((a) => {
      const r = prices.get(sourceKey(a));
      return `${a.symbol}: ${r && "error" in r ? r.error : "no result"}`;
    }).join("; ");
    throw httpError(`Price fetch failed — race not started. ${detail}`, 502);
  }

  const cashAsset = await db.asset.upsert({
    where: { symbol: "CASH" },
    update: {},
    create: { symbol: "CASH", name: "Cash", type: "cash", priceSource: "none", sourceId: "", quoteCurrency: race.currency },
  });

  const capital = Number(race.startingCapital);
  const day = new Date(now.toISOString().slice(0, 10)); // date-only

  await db.$transaction(async (tx) => {
    for (const player of players) {
      const valued: { quantity: number; price: number; assetId: number; symbol: string }[] = [];
      let allocated = 0;
      for (const pos of player.positions) {
        const res = prices.get(sourceKey(pos.asset as PriceAsset))!;
        const price = (res as { price: number }).price;
        const quantity = computeQuantity(Number(pos.allocation), price);
        allocated += Number(pos.allocation);
        await tx.position.update({ where: { id: pos.id }, data: { quantity, startPrice: price } });
        valued.push({ quantity, price, assetId: pos.assetId, symbol: (pos.asset as { symbol: string }).symbol });
      }
      const remainder = capital - allocated;
      if (remainder > 0.005) {
        await tx.position.create({
          data: { playerId: player.id, assetId: cashAsset.id, allocation: remainder, quantity: remainder, startPrice: 1 },
        });
        valued.push({ quantity: remainder, price: 1, assetId: cashAsset.id, symbol: "CASH" });
      }
      await tx.snapshot.upsert({
        where: { playerId_date: { playerId: player.id, date: day } },
        update: { totalValue: portfolioValue(valued), breakdown: valued.map((v) => ({ assetId: v.assetId, symbol: v.symbol, quantity: v.quantity, price: v.price, value: v.quantity * v.price })), stale: false },
        create: { playerId: player.id, date: day, totalValue: portfolioValue(valued), breakdown: valued.map((v) => ({ assetId: v.assetId, symbol: v.symbol, quantity: v.quantity, price: v.price, value: v.quantity * v.price })), stale: false },
      });
    }
    await tx.race.update({ where: { id: 1 }, data: { status: "running", startedAt: now } });
  });
}
```

NOTE for the test's fake `$transaction`: it just invokes the callback with the same db object — assertions on `db.race.update` therefore work whether or not Prisma would route it through `tx`.

`src/app/api/admin/start/route.ts`:

```ts
import { NextResponse } from "next/server";
import { startRace } from "@/lib/startRace";

export async function POST() {
  try {
    await startRace();
    return NextResponse.json({ ok: true });
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
```

- [ ] **Step 4: Run tests — pass.** `npm test -- tests/startRace.test.ts`

- [ ] **Step 5: Commit** — `feat: transactional race start with price lock-in`

---

### Task 7: Daily snapshot service + cron + boot catch-up

**Files:**
- Create: `src/lib/snapshot.ts`, `tests/snapshot.test.ts`, `src/instrumentation.ts`
- Modify: `next.config.ts` (nothing needed for instrumentation in Next 15 — it's on by default; only add `serverExternalPackages: ["node-cron"]` if the build complains)

**Interfaces:**
- Consumes: `getPrices`, `sourceKey`; `portfolioValue`; `prisma`.
- Produces:
  - `runSnapshot(deps?: { db?; fetchPrices?; now?: Date }): Promise<{ recorded: number; stale: boolean } | { skipped: string }>`
    - skips (returns `{skipped}`) when race not `running`.
    - For each player: value every position at fresh price; on per-asset fetch failure use that asset's most recent snapshot-breakdown price (search latest snapshots), mark player snapshot `stale: true`; if an asset has no prior price at all, use `startPrice`.
    - Upserts one snapshot per player for today's date.
  - `src/instrumentation.ts` `register()`: schedules cron `0 ${SNAPSHOT_HOUR} * * *` calling `runSnapshot`, and runs an immediate catch-up `runSnapshot` on boot if today's snapshots are missing.

- [ ] **Step 1: Failing tests**

`tests/snapshot.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { runSnapshot } from "@/lib/snapshot";

const asset = { id: 5, symbol: "VWCE", priceSource: "yahoo", sourceId: "VWCE.DE", quoteCurrency: "EUR", type: "etf" };

function makeDb(status = "running") {
  const snapshots: { playerId: number; date: Date; totalValue: number; stale: boolean; breakdown: unknown }[] = [];
  return {
    race: { upsert: vi.fn(async () => ({ id: 1, status, currency: "EUR", startingCapital: 10000 })) },
    player: {
      findMany: vi.fn(async () => [
        { id: 1, name: "Ana", positions: [{ id: 11, assetId: 5, allocation: 6000, quantity: 50, startPrice: 120, asset }] },
      ]),
    },
    snapshot: {
      findFirst: vi.fn(async () => ({
        breakdown: [{ assetId: 5, symbol: "VWCE", quantity: 50, price: 118, value: 5900 }],
      })),
      upsert: vi.fn(async ({ create }: { create: (typeof snapshots)[number] }) => { snapshots.push(create); return create; }),
    },
    _snapshots: snapshots,
  };
}

describe("runSnapshot", () => {
  it("records fresh values for each player", async () => {
    const db = makeDb();
    const fetchPrices = vi.fn(async () => new Map([["yahoo:VWCE.DE", { price: 130 }]]));
    const res = await runSnapshot({ db: db as never, fetchPrices: fetchPrices as never, now: new Date("2026-08-01T18:00:00Z") });
    expect(res).toEqual({ recorded: 1, stale: false });
    expect(db._snapshots[0].totalValue).toBe(6500); // 50 * 130
    expect(db._snapshots[0].stale).toBe(false);
  });

  it("falls back to last known price and flags stale", async () => {
    const db = makeDb();
    const fetchPrices = vi.fn(async () => new Map([["yahoo:VWCE.DE", { error: "down" }]]));
    const res = await runSnapshot({ db: db as never, fetchPrices: fetchPrices as never, now: new Date("2026-08-01T18:00:00Z") });
    expect(res).toEqual({ recorded: 1, stale: true });
    expect(db._snapshots[0].totalValue).toBe(5900); // 50 * 118 from prior snapshot
    expect(db._snapshots[0].stale).toBe(true);
  });

  it("skips when race is not running", async () => {
    const db = makeDb("setup");
    const res = await runSnapshot({ db: db as never, fetchPrices: vi.fn() as never });
    expect(res).toHaveProperty("skipped");
  });
});
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement**

`src/lib/snapshot.ts`:

```ts
import { prisma } from "@/lib/db";
import { getPrices, sourceKey, type PriceAsset } from "@/lib/prices";
import { portfolioValue } from "@/lib/valuation";

type Deps = { db?: typeof prisma; fetchPrices?: typeof getPrices; now?: Date };
type BreakdownRow = { assetId: number; symbol: string; quantity: number; price: number; value: number };

export async function runSnapshot({ db = prisma, fetchPrices = getPrices, now = new Date() }: Deps = {}) {
  const race = await db.race.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  if (race.status !== "running") return { skipped: `race status is ${race.status}` };

  const players = await db.player.findMany({ include: { positions: { include: { asset: true } } } });
  const assets = players.flatMap((p) => p.positions.map((pos) => pos.asset as PriceAsset));
  const prices = await fetchPrices(assets, race.currency);
  const day = new Date(now.toISOString().slice(0, 10));

  let anyStale = false;
  for (const player of players) {
    const rows: BreakdownRow[] = [];
    let stale = false;
    for (const pos of player.positions) {
      const a = pos.asset as PriceAsset & { symbol: string };
      const res = prices.get(sourceKey(a));
      let price: number;
      if (res && "price" in res) {
        price = res.price;
      } else {
        stale = true;
        price = (await lastKnownPrice(db, player.id, pos.assetId)) ?? Number(pos.startPrice);
      }
      const quantity = Number(pos.quantity);
      rows.push({ assetId: pos.assetId, symbol: a.symbol, quantity, price, value: quantity * price });
    }
    anyStale = anyStale || stale;
    const totalValue = portfolioValue(rows);
    await db.snapshot.upsert({
      where: { playerId_date: { playerId: player.id, date: day } },
      update: { totalValue, breakdown: rows, stale },
      create: { playerId: player.id, date: day, totalValue, breakdown: rows, stale },
    });
  }
  return { recorded: players.length, stale: anyStale };
}

async function lastKnownPrice(db: typeof prisma, playerId: number, assetId: number): Promise<number | null> {
  const snap = await db.snapshot.findFirst({ where: { playerId }, orderBy: { date: "desc" } });
  if (!snap) return null;
  const rows = snap.breakdown as unknown as BreakdownRow[];
  return rows.find((r) => r.assetId === assetId)?.price ?? null;
}
```

`src/instrumentation.ts`:

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const cron = (await import("node-cron")).default;
  const { runSnapshot } = await import("@/lib/snapshot");
  const hour = Number(process.env.SNAPSHOT_HOUR ?? 18);

  cron.schedule(`0 ${hour} * * *`, async () => {
    try { console.log("[cron] snapshot:", await runSnapshot()); }
    catch (e) { console.error("[cron] snapshot failed:", e); }
  }, { timezone: "UTC" });

  // Boot catch-up: record today if missing (runSnapshot upserts, so just run it)
  try { console.log("[boot] snapshot:", await runSnapshot()); }
  catch (e) { console.error("[boot] snapshot failed:", e); }
}
```

- [ ] **Step 4: Run tests — pass.** `npm test -- tests/snapshot.test.ts`
- [ ] **Step 5: Full test suite + build** — `npm test && npm run build`
- [ ] **Step 6: Commit** — `feat: daily snapshot service with cron and boot catch-up`

---

### Task 8: Public leaderboard page + chart + live values

**Files:**
- Create: `src/app/page.tsx`, `src/app/api/standings/route.ts`, `src/components/Chart.tsx`, `src/components/Leaderboard.tsx`
- Modify: `src/app/layout.tsx` (title), `src/app/globals.css` if needed

**Interfaces:**
- Consumes: `prisma`, `getPrices`/`sourceKey`, `percentGain`, `portfolioValue`.
- Produces: `GET /api/standings` returning:

```ts
type Standings = {
  race: { name: string; currency: string; startingCapital: number; status: string; startedAt: string | null };
  players: {
    id: number; name: string; strategy: string; color: string;
    currentValue: number; gainPct: number; stale: boolean;
    positions: { symbol: string; name: string; quantity: number; startPrice: number; currentPrice: number; value: number; gainPct: number }[];
  }[];
  history: { date: string; [playerName: string]: number | string }[]; // recharts-friendly
};
```

- [ ] **Step 1: Standings API**

`src/app/api/standings/route.ts` — computes live values with a 5-minute in-memory price cache:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getRace } from "@/lib/race";
import { getPrices, sourceKey, type PriceAsset, type PriceResult } from "@/lib/prices";
import { percentGain } from "@/lib/valuation";

export const dynamic = "force-dynamic";

let cache: { at: number; prices: Map<string, PriceResult> } | null = null;

export async function GET() {
  const race = await getRace();
  const players = await prisma.player.findMany({
    include: { positions: { include: { asset: true } } },
    orderBy: { id: "asc" },
  });

  let prices = new Map<string, PriceResult>();
  if (race.status === "running") {
    if (cache && Date.now() - cache.at < 5 * 60_000) {
      prices = cache.prices;
    } else {
      const assets = players.flatMap((p) => p.positions.map((pos) => pos.asset as PriceAsset));
      prices = await getPrices(assets, race.currency);
      cache = { at: Date.now(), prices };
    }
  }

  const capital = Number(race.startingCapital);
  const playerRows = players.map((p) => {
    let stale = false;
    const positions = p.positions.map((pos) => {
      const res = prices.get(sourceKey(pos.asset as PriceAsset));
      const startPrice = Number(pos.startPrice ?? 0);
      let currentPrice = startPrice;
      if (res && "price" in res) currentPrice = res.price;
      else if (race.status === "running") stale = true;
      const quantity = Number(pos.quantity ?? 0);
      return {
        symbol: pos.asset.symbol, name: pos.asset.name, quantity, startPrice, currentPrice,
        value: quantity * currentPrice,
        gainPct: startPrice > 0 ? percentGain(currentPrice, startPrice) : 0,
      };
    });
    const currentValue = positions.reduce((s, x) => s + x.value, 0);
    return {
      id: p.id, name: p.name, strategy: p.strategy, color: p.color,
      currentValue, gainPct: capital > 0 ? percentGain(currentValue, capital) : 0,
      stale, positions,
    };
  }).sort((a, b) => b.currentValue - a.currentValue);

  const snaps = await prisma.snapshot.findMany({ orderBy: { date: "asc" }, include: { player: true } });
  const byDate = new Map<string, Record<string, number | string>>();
  for (const s of snaps) {
    const d = s.date.toISOString().slice(0, 10);
    if (!byDate.has(d)) byDate.set(d, { date: d });
    byDate.get(d)![s.player.name] = Number(s.totalValue);
  }

  return NextResponse.json({
    race: { name: race.name, currency: race.currency, startingCapital: capital, status: race.status, startedAt: race.startedAt?.toISOString() ?? null },
    players: playerRows,
    history: [...byDate.values()],
  });
}
```

- [ ] **Step 2: Chart component (client)**

`src/components/Chart.tsx`:

```tsx
"use client";
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from "recharts";

export default function Chart({ history, players, startingCapital }: {
  history: Record<string, number | string>[];
  players: { name: string; color: string }[];
  startingCapital: number;
}) {
  if (history.length === 0) return null;
  return (
    <div style={{ width: "100%", height: 360 }}>
      <ResponsiveContainer>
        <LineChart data={history}>
          <XAxis dataKey="date" fontSize={12} />
          <YAxis domain={["auto", "auto"]} fontSize={12} width={70} />
          <Tooltip formatter={(v) => Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })} />
          <Legend />
          <ReferenceLine y={startingCapital} strokeDasharray="4 4" />
          {players.map((p) => (
            <Line key={p.name} type="monotone" dataKey={p.name} stroke={p.color} dot={false} strokeWidth={2} connectNulls />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 3: Leaderboard component (client, expandable rows)**

`src/components/Leaderboard.tsx`:

```tsx
"use client";
import { useState } from "react";

type Position = { symbol: string; name: string; quantity: number; startPrice: number; currentPrice: number; value: number; gainPct: number };
type Player = { id: number; name: string; strategy: string; color: string; currentValue: number; gainPct: number; stale: boolean; positions: Position[] };

const fmt = (n: number, d = 2) => n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });

export default function Leaderboard({ players, currency }: { players: Player[]; currency: string }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="space-y-2">
      {players.map((p, i) => (
        <div key={p.id} className="rounded-lg border border-gray-200 dark:border-gray-700">
          <button className="flex w-full items-center gap-3 p-3 text-left" onClick={() => setOpen(open === p.id ? null : p.id)}>
            <span className="w-6 text-lg font-bold">{i + 1}</span>
            <span className="h-3 w-3 rounded-full" style={{ background: p.color }} />
            <span className="flex-1">
              <span className="font-semibold">{p.name}</span>
              {p.strategy && <span className="ml-2 text-sm text-gray-500">{p.strategy}</span>}
              {p.stale && <span className="ml-2 text-xs text-amber-500" title="Some prices unavailable — showing last known">⚠ stale</span>}
            </span>
            <span className="font-mono">{fmt(p.currentValue)} {currency}</span>
            <span className={`w-24 text-right font-mono ${p.gainPct >= 0 ? "text-green-600" : "text-red-600"}`}>
              {p.gainPct >= 0 ? "+" : ""}{fmt(p.gainPct)}%
            </span>
          </button>
          {open === p.id && (
            <table className="w-full border-t border-gray-200 text-sm dark:border-gray-700">
              <thead><tr className="text-left text-gray-500">
                <th className="p-2">Asset</th><th className="p-2 text-right">Qty</th>
                <th className="p-2 text-right">Start</th><th className="p-2 text-right">Now</th>
                <th className="p-2 text-right">Value</th><th className="p-2 text-right">Gain</th>
              </tr></thead>
              <tbody>
                {p.positions.map((pos) => (
                  <tr key={pos.symbol}>
                    <td className="p-2">{pos.symbol} <span className="text-gray-500">{pos.name}</span></td>
                    <td className="p-2 text-right font-mono">{fmt(pos.quantity, 4)}</td>
                    <td className="p-2 text-right font-mono">{fmt(pos.startPrice)}</td>
                    <td className="p-2 text-right font-mono">{fmt(pos.currentPrice)}</td>
                    <td className="p-2 text-right font-mono">{fmt(pos.value)}</td>
                    <td className={`p-2 text-right font-mono ${pos.gainPct >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {pos.gainPct >= 0 ? "+" : ""}{fmt(pos.gainPct)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Page**

`src/app/page.tsx` (server component fetching standings directly is awkward with the in-memory cache — just make it a thin client page):

```tsx
"use client";
import { useEffect, useState } from "react";
import Chart from "@/components/Chart";
import Leaderboard from "@/components/Leaderboard";

type Standings = {
  race: { name: string; currency: string; startingCapital: number; status: string; startedAt: string | null };
  players: Parameters<typeof Leaderboard>[0]["players"];
  history: Record<string, number | string>[];
};

export default function Home() {
  const [data, setData] = useState<Standings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/standings")
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(setData)
      .catch((e) => setError(String(e)));
  }, []);

  if (error) return <main className="p-8">Failed to load: {error}</main>;
  if (!data) return <main className="p-8">Loading…</main>;

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-4 sm:p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{data.race.name}</h1>
          <p className="text-sm text-gray-500">
            {data.race.status === "running" && data.race.startedAt
              ? `Started ${data.race.startedAt.slice(0, 10)} · ${data.race.startingCapital.toLocaleString()} ${data.race.currency} each`
              : "Race not started yet"}
          </p>
        </div>
        <a href="/api/export" className="rounded bg-gray-800 px-3 py-2 text-sm text-white hover:bg-gray-700">
          Export .xlsx
        </a>
      </header>
      {data.race.status === "running" && (
        <Chart history={data.history} players={data.players} startingCapital={data.race.startingCapital} />
      )}
      <Leaderboard players={data.players} currency={data.race.currency} />
    </main>
  );
}
```

Update `src/app/layout.tsx` metadata title to `"Race to 1 Mil"`.

- [ ] **Step 5: Build check** — `npm run build`
- [ ] **Step 6: Commit** — `feat: public leaderboard page with progress chart`

---### Task 9: Admin UI

**Files:**
- Create: `src/app/admin/page.tsx`, `src/app/admin/login/page.tsx`

**Interfaces:**
- Consumes: all `/api/admin/*` routes from Tasks 4–6, `GET /api/admin/players`, `GET /api/admin/assets`.

- [ ] **Step 1: Login page**

`src/app/admin/login/page.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminLogin() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/admin/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) router.push("/admin");
    else setError((await res.json()).error ?? "Login failed");
  }

  return (
    <main className="mx-auto mt-24 max-w-sm p-4">
      <h1 className="mb-4 text-xl font-bold">Admin login</h1>
      <form onSubmit={submit} className="space-y-3">
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          placeholder="Password" className="w-full rounded border p-2" autoFocus />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="w-full rounded bg-gray-800 p-2 text-white">Log in</button>
      </form>
    </main>
  );
}
```

- [ ] **Step 2: Admin dashboard**

`src/app/admin/page.tsx` — one client component with three sections. State: `players`, `assets`, `race` loaded on mount from `/api/admin/players`, `/api/admin/assets`, `/api/standings`. Implement:

1. **Players section** — list with inline add form (name, strategy, color input `type="color"`), delete button per row. POST/DELETE to `/api/admin/players`.
2. **Assets section** — list with add form (symbol, name, type select, priceSource select, sourceId, quoteCurrency), delete per row. Show the API's 400 error inline when a symbol fails its price check.
3. **Positions section** — pick a player from a select; then one number input per asset (allocation amount); a running total `X / 10000` turning red when over; "Save positions" → PUT `/api/admin/positions`.
4. **Start section** — when race status is `setup`: big red "Start race — locks all positions at current prices" button with a `confirm()` dialog, POST `/api/admin/start`, then show success or the API error verbatim. When `running`: show "Race running since <date>" and disable all mutating forms (the API enforces it server-side regardless).

Keep it in one file (~250 lines); plain Tailwind, no component library. Any fetch error → render the JSON `error` string in a red banner at the top.

- [ ] **Step 3: Manual smoke test with local Postgres**

```bash
docker run -d --name race-pg -e POSTGRES_PASSWORD=dev -e POSTGRES_USER=race -e POSTGRES_DB=race -p 5432:5432 postgres:16
DATABASE_URL=postgresql://race:dev@localhost:5432/race npx prisma migrate dev --name init
DATABASE_URL=postgresql://race:dev@localhost:5432/race ADMIN_PASSWORD=test SESSION_SECRET=devsecret npm run dev
```

Verify: login works, wrong password rejected, can create player + asset (use `sourceId: "VWCE.DE"` — note this makes a real network call; acceptable for manual smoke test), set positions, `/` renders.

- [ ] **Step 4: Commit** — `feat: admin dashboard and login UI`

---

### Task 10: Excel export (TDD on workbook builder)

**Files:**
- Create: `src/lib/export.ts`, `tests/export.test.ts`, `src/app/api/export/route.ts`

**Interfaces:**
- Consumes: `prisma` (injected), `percentGain`.
- Produces:
  - `buildWorkbook(data: ExportData): Buffer` — pure, testable.
  - `type ExportData = { currency: string; startingCapital: number; players: { name: string; strategy: string; currentValue: number; gainPct: number }[]; history: { date: string; playerName: string; totalValue: number; stale: boolean }[]; positions: { playerName: string; symbol: string; assetName: string; allocation: number; quantity: number; startPrice: number }[] }`
  - `GET /api/export` → `.xlsx` download (public, no auth) with sheets `Leaderboard`, `History`, `Positions`.

- [ ] **Step 1: Failing test**

`tests/export.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { buildWorkbook } from "@/lib/export";

const data = {
  currency: "EUR", startingCapital: 10000,
  players: [{ name: "Ana", strategy: "ETF & chill", currentValue: 11000, gainPct: 10 }],
  history: [{ date: "2026-07-30", playerName: "Ana", totalValue: 10000, stale: false }],
  positions: [{ playerName: "Ana", symbol: "VWCE", assetName: "Vanguard FTSE All-World", allocation: 10000, quantity: 83.33, startPrice: 120 }],
};

describe("buildWorkbook", () => {
  it("produces a parseable workbook with the three sheets", () => {
    const buf = buildWorkbook(data);
    const wb = XLSX.read(buf);
    expect(wb.SheetNames).toEqual(["Leaderboard", "History", "Positions"]);
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Leaderboard"]);
    expect(rows[0]).toMatchObject({ Player: "Ana", "Value (EUR)": 11000, "Gain %": 10 });
  });
});
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement**

`src/lib/export.ts`:

```ts
import * as XLSX from "xlsx";

export type ExportData = {
  currency: string;
  startingCapital: number;
  players: { name: string; strategy: string; currentValue: number; gainPct: number }[];
  history: { date: string; playerName: string; totalValue: number; stale: boolean }[];
  positions: { playerName: string; symbol: string; assetName: string; allocation: number; quantity: number; startPrice: number }[];
};

export function buildWorkbook(data: ExportData): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    data.players.map((p, i) => ({
      Rank: i + 1, Player: p.name, Strategy: p.strategy,
      [`Value (${data.currency})`]: p.currentValue, "Gain %": p.gainPct,
    }))), "Leaderboard");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    data.history.map((h) => ({
      Date: h.date, Player: h.playerName,
      [`Value (${data.currency})`]: h.totalValue, Stale: h.stale ? "yes" : "",
    }))), "History");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    data.positions.map((p) => ({
      Player: p.playerName, Symbol: p.symbol, Asset: p.assetName,
      [`Allocation (${data.currency})`]: p.allocation, Quantity: p.quantity,
      [`Start price (${data.currency})`]: p.startPrice,
    }))), "Positions");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
```

- [ ] **Step 4: Run → pass.**

- [ ] **Step 5: Route**

`src/app/api/export/route.ts`:

```ts
import { prisma } from "@/lib/db";
import { getRace } from "@/lib/race";
import { percentGain } from "@/lib/valuation";
import { buildWorkbook } from "@/lib/export";

export const dynamic = "force-dynamic";

export async function GET() {
  const race = await getRace();
  const players = await prisma.player.findMany({ include: { positions: { include: { asset: true } } }, orderBy: { id: "asc" } });
  const snaps = await prisma.snapshot.findMany({ include: { player: true }, orderBy: { date: "asc" } });
  const capital = Number(race.startingCapital);

  const latestByPlayer = new Map<number, number>();
  for (const s of snaps) latestByPlayer.set(s.playerId, Number(s.totalValue));

  const buf = buildWorkbook({
    currency: race.currency,
    startingCapital: capital,
    players: players
      .map((p) => {
        const v = latestByPlayer.get(p.id) ?? capital;
        return { name: p.name, strategy: p.strategy, currentValue: v, gainPct: percentGain(v, capital) };
      })
      .sort((a, b) => b.currentValue - a.currentValue),
    history: snaps.map((s) => ({
      date: s.date.toISOString().slice(0, 10), playerName: s.player.name,
      totalValue: Number(s.totalValue), stale: s.stale,
    })),
    positions: players.flatMap((p) => p.positions.map((pos) => ({
      playerName: p.name, symbol: pos.asset.symbol, assetName: pos.asset.name,
      allocation: Number(pos.allocation), quantity: Number(pos.quantity ?? 0), startPrice: Number(pos.startPrice ?? 0),
    }))),
  });

  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="race-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  });
}
```

- [ ] **Step 6: Full suite + build** — `npm test && npm run build`
- [ ] **Step 7: Commit** — `feat: xlsx export with leaderboard, history, positions sheets`

---

### Task 11: Docker Compose, Dockerfile, entrypoint, README

**Files:**
- Create: `docker-compose.yml`, `Dockerfile`, `docker-entrypoint.sh`, `.dockerignore`, `README.md`
- Modify: `next.config.ts` (`output: "standalone"`), `package.json` (add `"migrate": "prisma migrate deploy"`)

**Interfaces:**
- Consumes: everything.
- Produces: `docker compose up` runs the full stack locally; Dokploy can deploy the repo as a Compose application.

- [ ] **Step 1: next.config.ts**

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
```

- [ ] **Step 2: Dockerfile (multi-stage)**

```dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules/prisma ./node_modules/prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/node_modules/.bin ./node_modules/.bin
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh
EXPOSE 3000
CMD ["./docker-entrypoint.sh"]
```

- [ ] **Step 3: Entrypoint**

`docker-entrypoint.sh`:

```bash
#!/bin/sh
set -e
echo "Running migrations..."
./node_modules/.bin/prisma migrate deploy
echo "Starting server..."
exec node server.js
```

- [ ] **Step 4: docker-compose.yml**

```yaml
services:
  web:
    build: .
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://race:${POSTGRES_PASSWORD:-changeme}@db:5432/race
      ADMIN_PASSWORD: ${ADMIN_PASSWORD:?set ADMIN_PASSWORD}
      SESSION_SECRET: ${SESSION_SECRET:?set SESSION_SECRET}
      SNAPSHOT_HOUR: ${SNAPSHOT_HOUR:-18}
      TZ: UTC
    depends_on:
      db:
        condition: service_healthy
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: race
      POSTGRES_DB: race
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-changeme}
    volumes:
      - race-db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U race -d race"]
      interval: 5s
      timeout: 3s
      retries: 10

volumes:
  race-db:
```

`.dockerignore`:

```
node_modules
.next
.git
docs
*.md
.env*
```

Note: `.dockerignore` excludes `.env*` so secrets only come from Dokploy env config.

- [ ] **Step 5: Ensure a migration exists in the repo**

```bash
docker run -d --name race-pg-mig -e POSTGRES_PASSWORD=dev -e POSTGRES_USER=race -e POSTGRES_DB=race -p 5433:5432 postgres:16-alpine
sleep 3
DATABASE_URL=postgresql://race:dev@localhost:5433/race npx prisma migrate dev --name init
docker rm -f race-pg-mig
git add prisma/migrations
```

(Skip if Task 9's smoke test already created and committed `prisma/migrations/`.)

- [ ] **Step 6: Local end-to-end verification**

```bash
ADMIN_PASSWORD=test SESSION_SECRET=devsecret docker compose up --build -d
sleep 10
curl -sf http://localhost:3000/api/standings | head -c 300
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/admin/players   # expect 401
curl -sf -X POST http://localhost:3000/api/admin/login -H 'Content-Type: application/json' -d '{"password":"test"}' -c /tmp/cookies.txt
curl -sf -b /tmp/cookies.txt http://localhost:3000/api/admin/players             # expect []
docker compose down
```

Expected: standings JSON, 401, login ok, empty players list.

- [ ] **Step 7: README**

`README.md` — short: what it is, screenshot placeholder omitted, then:

```markdown
# Race to 1 Mil

Friendly investment race: everyone gets a virtual 10k, picks a buy-and-hold
strategy, and the site tracks who's winning with daily price snapshots.

## Deploy on Dokploy

1. Create a **Compose** application pointing at this repo (compose file: `docker-compose.yml`).
2. Set environment variables: `ADMIN_PASSWORD`, `SESSION_SECRET` (long random string), `POSTGRES_PASSWORD`, optionally `SNAPSHOT_HOUR` (UTC hour, default 18).
3. Assign a domain to the `web` service, port 3000.
4. Deploy. Open `/admin`, log in, add players & assets, set allocations, hit **Start race**.

## Local dev

    docker compose up db -d
    cp .env.example .env   # edit DATABASE_URL to localhost
    npx prisma migrate dev
    npm run dev

## Notes

- Prices: Yahoo Finance (stocks/ETFs/gold, unofficial API) and CoinGecko (crypto). Free, no keys.
- Snapshots run daily at `SNAPSHOT_HOUR` UTC inside the web container; missed days are recorded on next boot.
- Export: the **Export .xlsx** button on the homepage.
```

- [ ] **Step 8: Commit** — `feat: docker compose stack for dokploy deployment`

---

## Self-Review Notes

- **Spec coverage:** setup/CRUD (T5), start-lock (T6), daily snapshot + catch-up + stale fallback (T7), public page/chart/live cache (T8), admin UI + auth (T4, T9), export (T10), Dokploy compose (T11). Currency conversion covered in T3. Rate-limited login in T4. All spec sections mapped.
- **Deferred detail:** per-asset stale indicator on the public page is simplified to a per-player flag — matches spec's "stale-price indicator when applicable."
- **Type consistency check done:** `PriceAsset`/`PriceResult`/`sourceKey` (T3) used identically in T6/T7/T8; `playerId_date` unique matches schema `@@unique([playerId, date])`; error `.status` convention consistent across routes.
