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
