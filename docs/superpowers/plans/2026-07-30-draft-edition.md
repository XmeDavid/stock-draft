# Draft Edition Implementation Plan (v2 delta)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the investment race into draft mode per `docs/superpowers/specs/2026-07-30-draft-edition-design.md`: player accounts, snake draft (10 picks × $1,000), scheduled or immediate start.

**Architecture:** Same stack (Next.js 16 App Router at `src/`, Prisma 6 + Postgres, node-cron via `src/instrumentation.ts`, proxy auth in `src/proxy.ts`). Tasks 1–9 of the v1 plan are merged; this plan renumbers from 12.

**Tech Stack additions:** none (password hashing via Node `crypto.scrypt`).

## Global Constraints

- Race status values: exactly `registration | drafting | drafted | running`.
- Defaults: currency `USD`, startingCapital `10000`, `picksPerPlayer` 10, `perPickAmount` 1000.
- Snake turn rule: with order array `O` of n players, pick index `i` belongs to `O[i % n]` when `floor(i/n)` is even, else `O[n - 1 - (i % n)]`.
- Pick exclusivity is by asset **symbol** (uppercased). One Position per asset globally during the draft.
- Player session cookie: name `race_player`, HMAC-signed payload `{playerId}` with `SESSION_SECRET`; httpOnly, sameSite lax, 30 days.
- Password storage: `scrypt`, format `salt:hash` (hex, 16-byte salt, 64-byte key).
- Draft ticker validation goes through Yahoo only; `Asset.type` maps Yahoo `instrumentType`: `CRYPTOCURRENCY→crypto`, `ETF→etf`, `FUTURE→gold`, else `equity`; `priceSource: "yahoo"`, `sourceId` = ticker, `quoteCurrency` from Yahoo meta.
- Errors thrown with `.status` number, routes map to HTTP (existing pattern).
- Tests: Vitest, mocked fetch/db, no real network. `npm test && npm run build` green at every task end.
- Commits after every task, conventional style.

## File Structure (delta)

```
prisma/schema.prisma                 # modify: Race/Player/Position fields
src/lib/race.ts                      # modify: assertPhase(...phases) replaces assertSetup
src/lib/session.ts                   # modify: generic signToken/verifyToken; keep admin API
src/lib/password.ts                  # new: hashPassword/verifyPassword (scrypt)
src/lib/playerSession.ts             # new: PLAYER_COOKIE, currentPlayerId(req)
src/lib/prices.ts                    # modify: add resolveTicker()
src/lib/draft.ts                     # new: turnFor, startDraft, makePick
src/lib/startRace.ts                 # modify: gate on `drafted`
src/instrumentation.ts               # modify: minute-tick auto-start
src/app/api/auth/{register,login,logout}/route.ts   # new
src/app/api/draft/route.ts           # new: GET state
src/app/api/draft/pick/route.ts      # new: POST player pick
src/app/api/admin/draft/{start,pick}/route.ts       # new
src/app/api/admin/schedule/route.ts  # new
src/app/api/admin/race/route.ts      # new: PUT config
src/app/api/admin/{players,assets,positions}/...    # prune obsolete handlers
src/app/{register,login}/page.tsx    # new
src/components/DraftBoard.tsx        # new
src/app/page.tsx                     # modify: phase-aware
src/app/admin/page.tsx               # rewrite: phase panels
tests/{password,draft,resolveTicker,authRoutes-helpers}.test.ts  # new
tests/startRace.test.ts              # modify: statuses
```

---

### Task 12: Schema v2, phase helper, startRace re-gating

**Files:**
- Modify: `prisma/schema.prisma`, `src/lib/race.ts`, `src/lib/startRace.ts`, `tests/startRace.test.ts`, admin routes that call `assertSetup` (`src/app/api/admin/players/route.ts`, `players/[id]/route.ts`, `assets/route.ts`, `assets/[id]/route.ts`, `positions/route.ts`)
- Create: `prisma/migrations/<ts>_draft_edition/` (via local dockerized Postgres, same recipe as Task 9's smoke test, committed)

**Interfaces:**
- Produces: `assertPhase(...phases: string[])` in `src/lib/race.ts` — returns race or throws `.status = 409` with message naming current phase and allowed phases. `getRace()` unchanged.
- Race gains: `picksPerPlayer Int @default(10)`, `perPickAmount Decimal @default(1000)`, `inviteCode String @default("")`, `draftOrder Json @default("[]")`, `currentPickIndex Int @default(0)`, `scheduledStartAt DateTime?`; `status @default("registration")`; `currency @default("USD")`.
- Player gains: `username String @unique`, `passwordHash String`.
- Position gains: `pickIndex Int?`.
- `startRace` requires `status === "drafted"` (409 otherwise; message "Race is not ready to start (status: X)"). Everything else in it unchanged.

- [ ] **Step 1: Schema edits** exactly per the Interfaces block above.
- [ ] **Step 2: Update `src/lib/race.ts`:**

```ts
import { prisma } from "@/lib/db";

export async function getRace() {
  return prisma.race.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}

export async function assertPhase(...phases: string[]) {
  const race = await getRace();
  if (!phases.includes(race.status)) {
    const err = new Error(
      `Not allowed in phase "${race.status}" (requires ${phases.join(" or ")})`
    );
    (err as Error & { status?: number }).status = 409;
    throw err;
  }
  return race;
}
```

Old admin CRUD callers of `assertSetup`: players `[id]` DELETE uses `assertPhase("registration")`; the obsolete mutating handlers are pruned in Task 17 — for THIS task just switch every existing `assertSetup()` call to `assertPhase("registration")` so the build stays green.

- [ ] **Step 3: `startRace` gate:** replace the `status !== "setup"` check with `status !== "drafted"`, error message "Race is not ready to start (status: ...)", status 409. Update `tests/startRace.test.ts` fakes: race fixture status `"drafted"` for the happy paths, `"running"` for the refusal test; add one refusal case for `"registration"`.
- [ ] **Step 4: Migration:** run a throwaway Postgres (docker, port 5433), `npx prisma migrate dev --name draft_edition`, stop container, `git add prisma/migrations`.
- [ ] **Step 5: Verify** `npm test && npm run build` green.
- [ ] **Step 6: Commit** — `feat: draft-edition schema and phase gating`

---

### Task 13: Password + generic tokens + player session + auth routes (TDD)

**Files:**
- Create: `src/lib/password.ts`, `src/lib/playerSession.ts`, `tests/password.test.ts`, `src/app/api/auth/register/route.ts`, `src/app/api/auth/login/route.ts`, `src/app/api/auth/logout/route.ts`
- Modify: `src/lib/session.ts`, `tests/session.test.ts`

**Interfaces:**
- Produces `src/lib/password.ts`:

```ts
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
```

- Produces in `src/lib/session.ts` (added; existing `signSession`/`verifySession`/`SESSION_COOKIE` refactored to wrap these, external behavior unchanged):

```ts
export function signToken(payload: object, secret: string): string;   // base64url(JSON).hmacHex
export function verifyToken<T>(token: string | undefined, secret: string): T | null;
```

- Produces `src/lib/playerSession.ts`:

```ts
import { verifyToken } from "@/lib/session";

export const PLAYER_COOKIE = "race_player";

export function playerIdFromCookie(cookieValue: string | undefined): number | null {
  const payload = verifyToken<{ playerId?: unknown }>(cookieValue, process.env.SESSION_SECRET ?? "");
  return typeof payload?.playerId === "number" ? payload.playerId : null;
}
```

- Routes:
  - `POST /api/auth/register` `{inviteCode, username, password, name?}` — phase `registration` only (`assertPhase`); 403 if `race.inviteCode` empty or mismatch; username trimmed, 3–20 chars `[a-zA-Z0-9_.-]`, 409 if taken (Prisma P2002 mapped); password ≥ 6 chars; creates Player (`name` defaults to username) and sets `race_player` cookie (httpOnly, lax, 30d). Returns `{id, username, name}` 201.
  - `POST /api/auth/login` `{username, password}` — 401 on unknown user or bad password (same message both ways); sets cookie; reuses the login route's rate-limit pattern from `/api/admin/login` (10 tries / 15 min per IP, in-memory).
  - `POST /api/auth/logout` — clears cookie (`maxAge: 0`).

- [ ] **Step 1: Failing tests** `tests/password.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/password";

describe("password hashing", () => {
  it("round-trips", () => {
    const stored = hashPassword("hunter22");
    expect(stored).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
    expect(verifyPassword("hunter22", stored)).toBe(true);
  });
  it("rejects wrong password", () => {
    expect(verifyPassword("nope", hashPassword("hunter22"))).toBe(false);
  });
  it("uses a fresh salt each time", () => {
    expect(hashPassword("x")).not.toBe(hashPassword("x"));
  });
  it("rejects malformed stored values", () => {
    expect(verifyPassword("x", "garbage")).toBe(false);
    expect(verifyPassword("x", "")).toBe(false);
  });
});
```

Add to `tests/session.test.ts`: `signToken({playerId: 7}, "s")` verifies via `verifyToken` to `{playerId: 7}`; wrong secret → null; tampered → null; admin round-trip still passes (regression).

- [ ] **Step 2: run → fail. Step 3: implement. Step 4: green + full suite + build.**
- [ ] **Step 5: Commit** — `feat: player accounts with scrypt passwords and sessions`

---

### Task 14: `resolveTicker` in the price service (TDD)

**Files:**
- Modify: `src/lib/prices.ts`, `tests/prices.test.ts`

**Interfaces:**
- Produces:

```ts
export type ResolvedTicker = { symbol: string; price: number; currency: string; name: string; type: string };
export async function resolveTicker(ticker: string): Promise<ResolvedTicker>;
```

Uses the same Yahoo v8 chart endpoint (single fetch). Reads `meta.regularMarketPrice`, `meta.currency`, `meta.instrumentType`, `meta.longName ?? meta.shortName ?? ticker`. Maps type per Global Constraints. Throws (with ticker in message) when the fetch fails, price missing, or currency missing. Symbol returned uppercased/trimmed.

- [ ] **Step 1: Failing tests** (extend the existing yahoo mock helper so `meta` carries `currency`, `instrumentType`, `longName`):

```ts
const yahooMeta = (meta: Record<string, unknown>) => ({
  ok: true,
  json: async () => ({ chart: { result: [{ meta }] } }),
});

describe("resolveTicker", () => {
  it("resolves price, currency, name, mapped type", async () => {
    mockFetch.mockResolvedValueOnce(yahooMeta({
      regularMarketPrice: 61234.5, currency: "USD",
      instrumentType: "CRYPTOCURRENCY", longName: "Bitcoin USD",
    }));
    expect(await resolveTicker(" btc-usd ")).toEqual({
      symbol: "BTC-USD", price: 61234.5, currency: "USD",
      name: "Bitcoin USD", type: "crypto",
    });
  });
  it("maps ETF and defaults to equity", async () => {
    mockFetch.mockResolvedValueOnce(yahooMeta({ regularMarketPrice: 1, currency: "EUR", instrumentType: "ETF" }));
    expect((await resolveTicker("VWCE.DE")).type).toBe("etf");
    mockFetch.mockResolvedValueOnce(yahooMeta({ regularMarketPrice: 1, currency: "USD", instrumentType: "EQUITY", shortName: "NVIDIA" }));
    const r = await resolveTicker("NVDA");
    expect(r.type).toBe("equity");
    expect(r.name).toBe("NVIDIA");
  });
  it("throws on missing price or not-ok", async () => {
    mockFetch.mockResolvedValueOnce(yahooMeta({ currency: "USD" }));
    await expect(resolveTicker("XXXX")).rejects.toThrow(/XXXX/);
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    await expect(resolveTicker("YYYY")).rejects.toThrow(/YYYY/);
  });
});
```

- [ ] **Steps 2–4: red → implement (share the fetch/URL helper with `yahooQuote`) → green + build.**
- [ ] **Step 5: Commit** — `feat: yahoo ticker resolution with type/currency metadata`

---

### Task 15: Draft engine (TDD)

**Files:**
- Create: `src/lib/draft.ts`, `tests/draft.test.ts`

**Interfaces:**
- Consumes: `resolveTicker` (injectable), `prisma` (injectable), `getRace` semantics via db fake.
- Produces:

```ts
export function turnFor(order: number[], pickIndex: number): number; // pure, throws on empty order
export async function startDraft(deps?: { db?; shuffle?: (ids: number[]) => number[] }): Promise<{ order: number[] }>;
// phase registration→drafting; >=2 players (409 otherwise); shuffle default: crypto-random Fisher-Yates
export async function makePick(input: { actorPlayerId: number | "admin"; symbol: string },
  deps?: { db?; resolve?: typeof resolveTicker }): Promise<{ pickIndex: number; symbol: string; playerId: number; done: boolean }>;
```

`makePick` logic (single `$transaction`):
1. race must be `drafting` (409).
2. `expected = turnFor(draftOrder, currentPickIndex)`; if `actorPlayerId !== "admin"` and `!== expected` → 403 "Not your turn".
3. `resolve(symbol)` → ResolvedTicker (failure → 400 with the resolver's message).
4. Exclusivity: existing Position joined to Asset with that symbol → 409 "SYMBOL already drafted".
5. Upsert Asset by symbol `{name, type, priceSource: "yahoo", sourceId: symbol, quoteCurrency: currency}`.
6. Create Position `{playerId: expected, assetId, allocation: race.perPickAmount, pickIndex: currentPickIndex}`.
7. Increment `currentPickIndex`; if it reaches `order.length * picksPerPlayer` → status `drafted`. Return `{done: true}` in that case.

- [ ] **Step 1: Failing tests** — cover at minimum:

```ts
describe("turnFor", () => {
  const order = [10, 20, 30, 40];
  it("snakes", () => {
    expect([0,1,2,3].map(i => turnFor(order, i))).toEqual([10,20,30,40]);
    expect([4,5,6,7].map(i => turnFor(order, i))).toEqual([40,30,20,10]);
    expect(turnFor(order, 8)).toBe(10);
  });
  it("throws on empty order", () => { expect(() => turnFor([], 0)).toThrow(); });
});
```

Plus, with a mocked db in the style of `tests/startRace.test.ts` (fixture race: status drafting, draftOrder [1,2], picksPerPlayer 2, perPickAmount 1000):
- startDraft: shuffles (inject identity shuffle), sets status/order/index, 409 when not registration, 409 with <2 players.
- makePick happy path: creates position for expected player with allocation 1000 and pickIndex, increments index.
- out-of-turn player → 403; admin actor picks for expected player.
- duplicate symbol → 409; resolver failure → 400.
- final pick flips status to `drafted` and returns `done: true` (fixture: index already at 3 of 4).

- [ ] **Steps 2–4: red → implement → green + build.**
- [ ] **Step 5: Commit** — `feat: snake draft engine`

---

### Task 16: Draft/auth/admin API routes + scheduled auto-start

**Files:**
- Create: `src/app/api/draft/route.ts`, `src/app/api/draft/pick/route.ts`, `src/app/api/admin/draft/start/route.ts`, `src/app/api/admin/draft/pick/route.ts`, `src/app/api/admin/schedule/route.ts`, `src/app/api/admin/race/route.ts`
- Modify: `src/instrumentation.ts`, `src/lib/snapshot.ts` (no change expected — verify), `tests/snapshot.test.ts` (only if fixtures need status rename — they use "running"/"setup"; change "setup" fixture to "registration")

**Interfaces:**
- `GET /api/draft` (public, `force-dynamic`): reads optional player cookie. Returns:

```ts
{
  status: string;
  roster: { id: number; name: string; username: string; color: string }[]; // registration order
  order: number[];                 // player ids, empty before draft
  currentPickIndex: number;
  currentPlayerId: number | null;  // null unless drafting
  yourPlayerId: number | null;     // from cookie
  yourTurn: boolean;
  picksPerPlayer: number;
  perPickAmount: number;
  scheduledStartAt: string | null;
  picks: { pickIndex: number; playerId: number; symbol: string; name: string }[]; // ordered
}
```

(Picks come from Positions where `pickIndex != null`, joined to Asset, ordered by pickIndex.)
- `POST /api/draft/pick {symbol}`: 401 without valid player cookie; calls `makePick({actorPlayerId: playerId, symbol})`; maps `.status`.
- `POST /api/admin/draft/start`: calls `startDraft()`.
- `POST /api/admin/draft/pick {symbol}`: `makePick({actorPlayerId: "admin", symbol})`.
- `POST /api/admin/schedule {startAt: string | null}`: phase `drafted` only; null clears; otherwise must parse as a future Date → sets `scheduledStartAt`.
- `PUT /api/admin/race {inviteCode?, name?, currency?}`: phase `registration` only; currency uppercase 3 letters.
- Instrumentation: keep the daily snapshot cron; add `* * * * *` tick: `const race = await getRace(); if (race.status === "drafted" && race.scheduledStartAt && new Date() >= race.scheduledStartAt) await startRace();` wrapped in try/catch (startRace's own 409 makes double-fire harmless — it flips status inside a transaction).

- [ ] **Step 1: implement routes** (error mapping pattern identical to existing admin routes).
- [ ] **Step 2: instrumentation tick** as above.
- [ ] **Step 3: fixture rename** in `tests/snapshot.test.ts` ("setup" → "registration"); confirm suite green, build green.
- [ ] **Step 4: Commit** — `feat: draft and scheduling APIs with auto-start tick`

---

### Task 17: Prune obsolete admin CRUD

**Files:**
- Delete: `src/app/api/admin/players/route.ts` POST handler (keep GET), `src/app/api/admin/assets/route.ts` POST handler (keep GET), `src/app/api/admin/assets/[id]/route.ts` (whole file), `src/app/api/admin/positions/route.ts` PUT handler (keep GET)
- Modify: `src/lib/assets.ts` (delete if now unused), `src/app/api/admin/players/[id]/route.ts` (keep DELETE with `assertPhase("registration")`, drop PUT)

**Interfaces:**
- Consumes: nothing new. Produces: leaner admin API — GETs for players/assets/positions, DELETE player (registration only).

- [ ] **Step 1: prune per the file list; `npm run build` catches dangling imports.**
- [ ] **Step 2: full suite + build green. Step 3: Commit** — `refactor: remove pre-draft admin CRUD surface`

---

### Task 18: Public UI — register/login pages, phase-aware home, draft board

**Files:**
- Create: `src/app/register/page.tsx`, `src/app/login/page.tsx`, `src/components/DraftBoard.tsx`
- Modify: `src/app/page.tsx`

**Interfaces:** consumes `GET /api/draft`, `POST /api/draft/pick`, `POST /api/auth/*`, existing `GET /api/standings`.

- [ ] **Step 1: `/register` and `/login`** — small client forms in the style of `src/app/admin/login/page.tsx`: register asks invite code, username, password, display name (optional); on success `router.push("/")`. Login asks username/password. Both render API error text inline.
- [ ] **Step 2: `DraftBoard`** (client component). Props: the `GET /api/draft` payload plus an `onPick(symbol)` callback and a `pickError` string. Renders:
  - the snake order as a horizontal list of player chips, current turn highlighted (by `currentPlayerId`), round number shown;
  - a table: one column per player (in draft order), rows = pick rounds, cells = `symbol` (+ small name), filling as picks land;
  - when `yourTurn`: an inline form (text input + "Draft" button) calling `onPick`; the 400/409 error text from the API shown under it;
  - when status `drafted`: banner "Draft complete — waiting for start" (+ scheduled time if set).
- [ ] **Step 3: phase-aware home** — `src/app/page.tsx` fetches `/api/draft` first; if status `running` fetch `/api/standings` and render the existing Chart + Leaderboard exactly as today; else render: registration → roster list + "Race is forming — register to join" linking `/register` (hide link when logged in, show "logged in as X" + logout button); drafting/drafted → `DraftBoard` (poll `/api/draft` every 5 s while drafting so the board advances without reload; `cache: "no-store"` on fetches). Keep the Export button only when running.
- [ ] **Step 4: `npm test` + `npm run build` green. Step 5: Commit** — `feat: draft board and player-facing pages`

---

### Task 19: Admin UI rework — phase panels

**Files:**
- Rewrite: `src/app/admin/page.tsx` (login page untouched)

**Interfaces:** consumes `GET /api/draft`, `PUT /api/admin/race`, `GET /api/admin/players` + `DELETE /api/admin/players/:id`, `POST /api/admin/draft/start`, `POST /api/admin/draft/pick`, `POST /api/admin/start`, `POST /api/admin/schedule`.

- [ ] **Step 1: rewrite as one client component with a panel per phase** (state from `/api/draft`, refreshed after every action, 5 s poll during drafting):
  - **registration:** invite-code input + save (`PUT /api/admin/race`), race name/currency inputs, roster with per-player Remove, "Start draft" button (confirm dialog; disabled + hint under 2 players);
  - **drafting:** embed the same data DraftBoard shows (reuse `DraftBoard` with an `adminPick` variant: the inline form always visible, labeled "Pick for <current player>", posting to `/api/admin/draft/pick`);
  - **drafted:** "Start race now" (confirm) + datetime-local input & "Schedule start" / "Clear schedule" buttons; show scheduled time;
  - **running:** "Race running since <date>" + link to `/`.
  - All errors render in the existing red banner pattern.
- [ ] **Step 2: build + suite green. Step 3: Commit** — `feat: phase-based admin console`

---

### Task 20: End-to-end smoke test (full draft flow, real stack)

**Files:**
- Create: none required (throwaway scripts under scratchpad ok). This is a verification task; fixes it uncovers are made in place.

- [ ] **Step 1:** local Postgres (docker, recipe from Task 9), `prisma migrate dev`, `npm run dev` with ADMIN_PASSWORD/SESSION_SECRET set.
- [ ] **Step 2 (scripted via curl, cookie jars per player):** admin login → set invite code "friends2026" → register alice, bob (2 players) → admin start draft → read `/api/draft`, follow `currentPlayerId` and alternate picks 2×10 twenty times with real tickers (mix stocks/ETF/crypto: NVDA, BTC-USD, VWCE.DE, GC=F…) asserting snake order and one 409 duplicate-pick attempt and one 403 out-of-turn attempt → status becomes `drafted` → admin schedule start 1 min ahead → wait for tick → status `running`, first snapshot exists → `/api/standings` shows 2 players at ≈$20,000 total, `/api/export` (if Task 10/21 landed; else skip) → screenshots optional.
- [ ] **Step 3:** tear down container; report transcript in task report.
- [ ] **Step 4: Commit** any fixes made — `fix: issues found in draft-flow smoke test` (skip commit if none).

---

**Carry-over tasks from v1 plan (unchanged, renumber only):** Task 10 (xlsx export) and Task 11 (Docker Compose + README — README copy updated to describe the draft flow) execute after Task 20, in that order, exactly as written in `2026-07-30-investment-race.md` (README "Deploy" step 4 becomes: "Open /admin, set the invite code, share it; friends register; run the draft; start or schedule the race").

## Self-Review Notes

- Spec coverage: accounts/registration (T13), draft mechanics + exclusivity + snake (T15/T16), scheduled start (T16), UI both sides (T18/T19), pruning (T17), migration (T12), e2e proof (T20), export/deploy carried over. Currency default USD in T12 schema.
- Type consistency: `assertPhase` replaces `assertSetup` everywhere; statuses match Global Constraints; `makePick` return shape used by both pick routes; `GET /api/draft` payload is the single contract both UIs consume.
- Known simplification: no pick timer (admin picks on behalf), no username change/password reset — YAGNI per spec.
