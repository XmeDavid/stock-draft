import { describe, it, expect, vi } from "vitest";
import { turnFor, startDraft, makePick } from "@/lib/draft";

type RaceFixture = {
  id: number;
  status: string;
  draftOrder: number[];
  currentPickIndex: number;
  picksPerPlayer: number;
  perPickAmount: number;
};

function makeDb(race: Partial<RaceFixture> = {}, overrides: Record<string, unknown> = {}) {
  const raceRow: RaceFixture = {
    id: 1,
    status: "drafting",
    draftOrder: [1, 2],
    currentPickIndex: 0,
    picksPerPlayer: 2,
    perPickAmount: 1000,
    ...race,
  };
  const db = {
    race: {
      upsert: vi.fn(async () => raceRow),
      update: vi.fn(async () => raceRow),
    },
    player: {
      findMany: vi.fn(async () => [{ id: 1 }, { id: 2 }]),
    },
    position: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: unknown }) => ({ id: 77, ...(data as object) })),
    },
    asset: {
      upsert: vi.fn(async ({ create }: { create: { symbol: string } }) => ({ id: 42, ...create })),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
    _race: raceRow,
    ...overrides,
  };
  return db;
}

const identityShuffle = (ids: number[]) => ids;

describe("turnFor", () => {
  const order = [10, 20, 30, 40];
  it("snakes", () => {
    expect([0, 1, 2, 3].map((i) => turnFor(order, i))).toEqual([10, 20, 30, 40]);
    expect([4, 5, 6, 7].map((i) => turnFor(order, i))).toEqual([40, 30, 20, 10]);
    expect(turnFor(order, 8)).toBe(10);
  });
  it("throws on empty order", () => {
    expect(() => turnFor([], 0)).toThrow();
  });
});

describe("startDraft", () => {
  it("shuffles, sets status/order/index", async () => {
    const db = makeDb({ status: "registration" });
    const shuffle = vi.fn((ids: number[]) => [...ids].reverse());
    const { order } = await startDraft({ db: db as never, shuffle });
    expect(shuffle).toHaveBeenCalledWith([1, 2]);
    expect(order).toEqual([2, 1]);
    expect(db.race.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "drafting", draftOrder: [2, 1], currentPickIndex: 0 }),
      })
    );
  });

  it("refuses when not in registration (409)", async () => {
    const db = makeDb({ status: "drafting" });
    await expect(startDraft({ db: db as never, shuffle: identityShuffle })).rejects.toMatchObject({
      status: 409,
    });
    expect(db.race.update).not.toHaveBeenCalled();
  });

  it("refuses with fewer than 2 players (409)", async () => {
    const db = makeDb({ status: "registration" }, { player: { findMany: vi.fn(async () => [{ id: 1 }]) } });
    await expect(startDraft({ db: db as never, shuffle: identityShuffle })).rejects.toMatchObject({
      status: 409,
    });
    expect(db.race.update).not.toHaveBeenCalled();
  });

  it("produces a permutation with the default crypto shuffle", async () => {
    const db = makeDb(
      { status: "registration" },
      { player: { findMany: vi.fn(async () => [1, 2, 3, 4, 5].map((id) => ({ id }))) } }
    );
    const { order } = await startDraft({ db: db as never });
    expect([...order].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });
});

const resolved = { symbol: "AAPL", price: 200, currency: "USD", name: "Apple Inc.", type: "equity" };

describe("makePick", () => {
  it("creates the position for the expected player and increments the index", async () => {
    const db = makeDb({ currentPickIndex: 1 });
    const resolve = vi.fn(async () => resolved);
    const out = await makePick({ actorPlayerId: 2, symbol: "aapl" }, { db: db as never, resolve: resolve as never });
    expect(out).toEqual({ pickIndex: 1, symbol: "AAPL", playerId: 2, done: false });
    expect(db.asset.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { symbol: "AAPL" },
        create: {
          symbol: "AAPL",
          name: "Apple Inc.",
          type: "equity",
          priceSource: "yahoo",
          sourceId: "AAPL",
          quoteCurrency: "USD",
        },
      })
    );
    expect(db.position.create).toHaveBeenCalledWith({
      data: { playerId: 2, assetId: 42, allocation: 1000, pickIndex: 1 },
    });
    expect(db.race.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ currentPickIndex: 2 }) })
    );
    expect(db.race.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "drafted" }) })
    );
  });

  it("rejects a player picking out of turn with 403", async () => {
    const db = makeDb({ currentPickIndex: 0 });
    const resolve = vi.fn(async () => resolved);
    await expect(
      makePick({ actorPlayerId: 2, symbol: "AAPL" }, { db: db as never, resolve: resolve as never })
    ).rejects.toMatchObject({ status: 403, message: expect.stringMatching(/Not your turn/) });
    expect(db.position.create).not.toHaveBeenCalled();
  });

  it("lets an admin actor pick for the expected player", async () => {
    const db = makeDb({ currentPickIndex: 0 });
    const resolve = vi.fn(async () => resolved);
    const out = await makePick(
      { actorPlayerId: "admin", symbol: "AAPL" },
      { db: db as never, resolve: resolve as never }
    );
    expect(out.playerId).toBe(1);
    expect(db.position.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ playerId: 1 }) })
    );
  });

  it("refuses when the race is not drafting (409)", async () => {
    const db = makeDb({ status: "registration" });
    const resolve = vi.fn(async () => resolved);
    await expect(
      makePick({ actorPlayerId: "admin", symbol: "AAPL" }, { db: db as never, resolve: resolve as never })
    ).rejects.toMatchObject({ status: 409 });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("rejects a symbol already drafted with 409", async () => {
    const db = makeDb({}, { position: { findFirst: vi.fn(async () => ({ id: 5 })), create: vi.fn() } });
    const resolve = vi.fn(async () => resolved);
    await expect(
      makePick({ actorPlayerId: 1, symbol: "AAPL" }, { db: db as never, resolve: resolve as never })
    ).rejects.toMatchObject({ status: 409, message: "AAPL already drafted" });
    expect(db.position.create).not.toHaveBeenCalled();
  });

  it("maps a resolver failure to 400 with the resolver message", async () => {
    const db = makeDb();
    const resolve = vi.fn(async () => {
      throw new Error("yahoo NOPE: no price in response");
    });
    await expect(
      makePick({ actorPlayerId: 1, symbol: "NOPE" }, { db: db as never, resolve: resolve as never })
    ).rejects.toMatchObject({ status: 400, message: "yahoo NOPE: no price in response" });
    expect(db.position.create).not.toHaveBeenCalled();
  });

  it("flips the race to drafted on the final pick and reports done", async () => {
    const db = makeDb({ currentPickIndex: 3 });
    const resolve = vi.fn(async () => resolved);
    const out = await makePick({ actorPlayerId: 1, symbol: "AAPL" }, { db: db as never, resolve: resolve as never });
    expect(out).toEqual({ pickIndex: 3, symbol: "AAPL", playerId: 1, done: true });
    expect(db.race.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ currentPickIndex: 4, status: "drafted" }) })
    );
  });
});
