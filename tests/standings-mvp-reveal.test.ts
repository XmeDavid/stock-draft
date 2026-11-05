import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { emptyActionLog } from "@/lib/corporateActions";
import { mvpRevealed } from "@/lib/mvpReveal";
import { SESSION_COOKIE, signSession } from "@/lib/session";

const mocks = vi.hoisted(() => ({ graceLockedMvp: false }));

vi.mock("@/lib/raceClock", () => ({ advanceRaceClock: async () => undefined }));
vi.mock("@/lib/race", () => ({
  getRace: async () => ({
    name: "Race",
    currency: "USD",
    startingCapital: 2000,
    status: "running",
    startedAt: new Date("2026-07-01T09:00:00Z"),
    endAt: new Date("2026-12-31T00:00:00Z"),
    finishedAt: null,
  }),
}));
vi.mock("@/lib/mergerMap", () => ({ mergerMappings: [] }));
vi.mock("@/lib/applyCorporateActions", () => ({
  applyConfiguredMappings: async () => [],
  applySplitsFromQuotes: async () => false,
  recoverPunctuation: async () => false,
  readActionLogOrReport: async () => emptyActionLog(),
}));
vi.mock("@/lib/prices", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/prices")>(),
  getPrices: async () => new Map([["yahoo:ACME", { price: 120 }], ["yahoo:ZETA", { price: 100 }]]),
}));

function pick(id: number, playerId: number, symbol: string, isMvp: boolean) {
  return {
    id,
    playerId,
    assetId: id + 50,
    allocation: 1000,
    quantity: 10,
    startPrice: 100,
    pickIndex: id,
    isMvp,
    asset: { id: id + 50, symbol, name: symbol, type: "equity", priceSource: "yahoo", sourceId: symbol, quoteCurrency: "USD" },
  };
}

vi.mock("@/lib/data", () => ({
  getPlayersWithPositions: async () => [
    // Ada locked ACME as MVP; Grace's lock depends on the test.
    { id: 1, name: "Ada", strategy: "", color: "#000", positions: [pick(1, 1, "ACME", true), pick(2, 1, "ZETA", false)] },
    { id: 2, name: "Grace", strategy: "", color: "#111", positions: [pick(3, 2, "ACME", false), pick(4, 2, "ZETA", mocks.graceLockedMvp)] },
  ],
  getSnapshotsWithPlayers: async () => [{
    player: { id: 1, name: "Ada" },
    snapshot: {
      playerId: 1,
      date: new Date("2026-07-31T00:00:00Z"),
      capturedAt: new Date("2026-07-31T18:00:00Z"),
      // 10 ACME at 130 with MVP leverage is 1600; at market it is 1300.
      totalValue: 2600,
      stale: false,
      breakdown: [
        { positionId: 1, assetId: 51, symbol: "ACME", quantity: 10, price: 130, value: 1600, allocation: 1000, isMvp: true },
        { positionId: 2, assetId: 52, symbol: "ZETA", quantity: 10, price: 100, value: 1000, allocation: 1000, isMvp: false },
      ],
    },
  }],
}));

const { GET } = await import("@/app/api/standings/route");

type Body = {
  players: {
    id: number;
    currentValue: number;
    achievements: string[];
    profileHistory: Record<string, number | string>[];
    positions: { symbol: string; isMvp?: boolean; value: number; gainPct: number; marketGainPct: number }[];
  }[];
  history: Record<string, number | string>[];
};

async function standings(cookie?: string): Promise<{ raw: string; body: Body }> {
  const response = await GET(new NextRequest("http://localhost/api/standings", cookie ? { headers: { cookie } } : undefined));
  const raw = await response.text();
  return { raw, body: JSON.parse(raw) as Body };
}

beforeEach(() => {
  process.env.SESSION_SECRET = "test-secret";
  mocks.graceLockedMvp = false;
});

describe("fix 14: public standings hide MVP picks until the reveal", () => {
  it("contains no MVP flag or leveraged value before every player has locked one", async () => {
    const { raw, body } = await standings();

    expect(raw).not.toMatch(/isMvp/i);
    const ada = body.players.find((player) => player.id === 1)!;
    const acme = ada.positions.find((position) => position.symbol === "ACME")!;
    // Valued at market (10 × 120), not with the MVP's doubled gain (1400).
    expect(acme.value).toBe(1200);
    expect(acme.gainPct).toBeCloseTo(acme.marketGainPct);
    expect(ada.currentValue).toBe(2200);
    expect(ada.achievements).not.toContain("Captain's Call");
    // Snapshot totals and per-pick history are restated at market too.
    expect(body.history.find((row) => row.date === "2026-07-31")?.["1"]).toBe(2300);
    expect(ada.profileHistory.find((row) => row.date === "2026-07-31")?.ACME).toBeCloseTo(30);
    expect(raw).not.toContain("2600");
    expect(raw).not.toContain("1600");
  });

  it("shows MVP picks and leveraged values once every MVP is locked", async () => {
    mocks.graceLockedMvp = true;
    const { body } = await standings();

    const ada = body.players.find((player) => player.id === 1)!;
    const acme = ada.positions.find((position) => position.symbol === "ACME")!;
    expect(acme.isMvp).toBe(true);
    expect(acme.value).toBe(1400);
    expect(ada.positions.find((position) => position.symbol === "ZETA")?.isMvp).toBe(false);
    expect(body.history.find((row) => row.date === "2026-07-31")?.["1"]).toBe(2600);
  });

  it("always shows MVP picks to an admin session", async () => {
    const { body } = await standings(`${SESSION_COOKIE}=${signSession("test-secret")}`);
    const acme = body.players.find((player) => player.id === 1)!.positions.find((position) => position.symbol === "ACME")!;
    expect(acme.isMvp).toBe(true);
    expect(acme.value).toBe(1400);
  });

  it("ignores a forged admin cookie", async () => {
    const { raw } = await standings(`${SESSION_COOKIE}=${signSession("wrong-secret")}`);
    expect(raw).not.toMatch(/isMvp/i);
  });
});

describe("shared reveal rule", () => {
  it("reveals only when every player has locked a drafted MVP pick", () => {
    expect(mvpRevealed(0, [])).toBe(false);
    expect(mvpRevealed(2, [{ isMvp: true, pickIndex: 0 }, { isMvp: false, pickIndex: 1 }])).toBe(false);
    expect(mvpRevealed(2, [{ isMvp: true, pickIndex: 0 }, { isMvp: true, pickIndex: 1 }])).toBe(true);
    // The race-start cash row has no pick index and never counts.
    expect(mvpRevealed(2, [{ isMvp: true, pickIndex: 0 }, { isMvp: true, pickIndex: null }])).toBe(false);
  });
});
