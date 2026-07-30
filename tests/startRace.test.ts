import { describe, it, expect, vi } from "vitest";
import { startRace } from "@/lib/startRace";

function makeDb(overrides: Record<string, unknown> = {}) {
  const positionsStore: Record<number, { quantity: number; startPrice: number }> = {};
  const snapshots: unknown[] = [];
  const db = {
    race: {
      upsert: vi.fn(async () => ({ id: 1, status: "drafted", currency: "EUR", startingCapital: 10000 })),
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
    await expect(startRace({ db: db as never })).rejects.toThrow(/not ready to start \(status: running\)/);
    expect(db.race.update).not.toHaveBeenCalled();
  });

  it("refuses when the draft has not happened yet", async () => {
    const db = makeDb({
      race: { upsert: vi.fn(async () => ({ id: 1, status: "registration", currency: "EUR", startingCapital: 10000 })), update: vi.fn() },
    });
    await expect(startRace({ db: db as never })).rejects.toThrow(/not ready to start \(status: registration\)/);
    expect(db.race.update).not.toHaveBeenCalled();
  });
});
