import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyActionLog, type ActionLog } from "@/lib/corporateActions";
import type { PriceResult } from "@/lib/prices";

const mocks = vi.hoisted(() => ({
  quantities: [] as number[],
  revisions: [] as number[],
  writeResults: [] as boolean[],
  history: [] as unknown[],
  inserted: [] as { playerId: number; breakdown: Record<string, unknown>[]; stale: boolean; totalValue: number }[],
  applySplitsFromQuotes: vi.fn(async () => false),
  writeAtActionRevision: vi.fn(),
}));

vi.mock("@/lib/race", () => ({ getRace: async () => ({ status: "running", currency: "USD" }) }));
vi.mock("@/lib/mergerMap", () => ({ mergerMappings: [] }));
vi.mock("@/lib/data", () => ({
  getPlayersWithPositions: async () => {
    const quantity = mocks.quantities.length > 1 ? mocks.quantities.shift()! : mocks.quantities[0];
    return [{
      id: 10,
      name: "Ada",
      positions: [{
        id: 1,
        playerId: 10,
        assetId: 5,
        allocation: 1000,
        quantity,
        startPrice: 1000 / quantity,
        pickIndex: 0,
        isMvp: false,
        asset: { id: 5, symbol: "ACME", name: "Acme", type: "equity", priceSource: "yahoo", sourceId: "ACME", quoteCurrency: "USD" },
      }],
    }];
  },
}));
vi.mock("@/lib/applyCorporateActions", () => ({
  reconcileBeforeSnapshot: async () => undefined,
  readActionLogOrReport: async (): Promise<ActionLog> => ({ ...emptyActionLog(), revision: 0 }),
  readActionLog: async (): Promise<ActionLog> => ({
    ...emptyActionLog(),
    revision: mocks.revisions.length > 1 ? mocks.revisions.shift()! : mocks.revisions[0],
  }),
  applySplitsFromQuotes: mocks.applySplitsFromQuotes,
  writeAtActionRevision: mocks.writeAtActionRevision,
}));

const insertDb = {
  insert: () => ({
    values: (value: (typeof mocks.inserted)[number]) => ({
      onConflictDoUpdate: async () => {
        mocks.inserted.push(value);
      },
    }),
  }),
};
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    ...insertDb,
    select: () => ({ from: () => ({ orderBy: async () => mocks.history }) }),
  }),
}));

const { runSnapshot } = await import("@/lib/snapshot");

function prices(price: number | { error: string }) {
  return vi.fn(async (): Promise<Map<string, PriceResult>> =>
    new Map([["yahoo:ACME", typeof price === "number" ? { price } : price]])
  );
}

beforeEach(() => {
  mocks.inserted.length = 0;
  mocks.history.length = 0;
  mocks.applySplitsFromQuotes.mockClear();
  mocks.writeAtActionRevision.mockReset();
  mocks.writeAtActionRevision.mockImplementation(async (_revision: number, write: (db: typeof insertDb) => Promise<void>) => {
    if (mocks.writeResults.shift() === false) return false;
    await write(insertDb);
    return true;
  });
  mocks.writeResults = [];
});

describe("fix 5: snapshots never mix old quantities with new prices", () => {
  it("reloads holdings after another request applied a split during the quote fetch", async () => {
    // Loaded at 10 shares; a concurrent standings request then split ACME 2-for-1 (revision 0 → 1).
    mocks.quantities = [10, 20];
    mocks.revisions = [1];
    const fetchPrices = prices(50);

    await runSnapshot({ fetchPrices, now: new Date("2026-08-01T18:00:00Z") });

    expect(mocks.inserted).toHaveLength(1);
    expect(mocks.inserted[0].breakdown[0]).toMatchObject({ positionId: 1, quantity: 20, price: 50, value: 1000 });
    expect(mocks.inserted[0].totalValue).toBe(1000);
    // Quotes are refetched because they were taken at an older revision.
    expect(fetchPrices).toHaveBeenCalledTimes(2);
  });

  it("retries when an action commits between valuing and writing", async () => {
    mocks.quantities = [10];
    mocks.revisions = [0, 1];
    mocks.writeResults = [false, true];

    await runSnapshot({ fetchPrices: prices(100), now: new Date("2026-08-01T18:00:00Z") });

    expect(mocks.writeAtActionRevision).toHaveBeenCalledTimes(2);
    expect(mocks.writeAtActionRevision.mock.calls.map(([revision]) => revision)).toEqual([0, 1]);
    expect(mocks.inserted).toHaveLength(1);
  });
});

describe("fix 1 in snapshots: fallback scaled per position", () => {
  it("restates the last snapshot price after a conversion halved the share count", async () => {
    mocks.quantities = [5];
    mocks.revisions = [0];
    mocks.history.push({
      playerId: 10,
      capturedAt: new Date("2026-07-31T18:00:00Z"),
      breakdown: [{ positionId: 1, assetId: 5, quantity: 10, price: 120 }],
    });

    await runSnapshot({ fetchPrices: prices({ error: "yahoo ACME: HTTP 429" }), now: new Date("2026-08-01T18:00:00Z") });

    expect(mocks.inserted[0].breakdown[0]).toMatchObject({
      quantity: 5,
      price: 240,
      value: 1200,
      pricingStatus: "unpriced",
      priceBasis: "last-snapshot",
      // A 429 is an outage, not a corporate action (fix 13).
      possibleCorporateAction: false,
    });
    expect(mocks.inserted[0].stale).toBe(true);
  });
});
