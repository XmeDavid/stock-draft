import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { assets, players, positions } from "@db/schema";
import {
  AlreadyAppliedError,
  CorruptActionLogError,
  emptyActionLog,
  parseActionLog,
  type MergerMapping,
} from "@/lib/corporateActions";
import { readQuoteCache, writeQuoteCache } from "@/lib/quoteCache";

type Row = Record<string, unknown>;
type Condition = { column: unknown; value: unknown } | undefined;

const mocks = vi.hoisted(() => ({
  tables: new Map<unknown, Record<string, unknown>[]>(),
  nextId: { value: 100 },
  mappings: [] as unknown[],
}));

vi.mock("drizzle-orm", async (importOriginal) => ({
  ...await importOriginal<typeof import("drizzle-orm")>(),
  eq: (column: unknown, value: unknown) => ({ column, value }),
}));
vi.mock("@/lib/race", () => ({
  getRace: async () => ({ status: "running", startedAt: new Date("2026-07-01T09:00:00Z"), currency: "USD" }),
}));
vi.mock("@/lib/mergerMap", () => ({ mergerMappings: mocks.mappings }));
vi.mock("@/lib/prices", () => ({
  fetchYahooSplitEvents: vi.fn(async () => []),
  resolveTicker: vi.fn(async () => {
    throw new Error("offline");
  }),
}));
vi.mock("@/lib/db", () => ({ getDb: () => fakeDb }));

function rowsOf(table: unknown): Row[] {
  if (!mocks.tables.has(table)) mocks.tables.set(table, []);
  return mocks.tables.get(table)!;
}

function columnKey(table: unknown, column: unknown): string {
  for (const [key, candidate] of Object.entries(getTableColumns(table as typeof assets))) {
    if (candidate === column) return key;
  }
  throw new Error("unknown column");
}

function matches(row: Row, table: unknown, condition: Condition): boolean {
  return !condition || row[columnKey(table, condition.column)] === condition.value;
}

/** The row a column is read from: the row itself, or the asset/player a position joins to. */
function joined(table: unknown, from: unknown, row: Row): Row {
  if (table === from) return row;
  if (table === assets) return rowsOf(assets).find((asset) => asset.id === row.assetId) ?? {};
  if (table === players) return rowsOf(players).find((player) => player.id === row.playerId) ?? {};
  return row;
}

function thenable<T>(run: () => T) {
  return {
    then(resolve: (value: T) => unknown, reject: (error: unknown) => unknown) {
      try {
        return Promise.resolve(resolve(run()));
      } catch (error) {
        return Promise.resolve(reject(error));
      }
    },
  };
}

const fakeDb = {
  select(selection?: Record<string, unknown>) {
    return {
      from(table: unknown) {
        let condition: Condition;
        const run = () => rowsOf(table).filter((row) => matches(row, table, condition)).map((row) => {
          if (!selection) return { ...row };
          return Object.fromEntries(Object.entries(selection).map(([key, column]) => {
            const owner = (column as { table: unknown }).table;
            return [key, joined(owner, table, row)[columnKey(owner, column)]];
          }));
        });
        const query = {
          innerJoin: () => query,
          where: (next: Condition) => {
            condition = next;
            return query;
          },
          limit: () => query,
          for: () => query,
          orderBy: () => query,
          ...thenable(run),
        };
        return query;
      },
    };
  },
  insert(table: unknown) {
    return {
      values(value: Row) {
        const insert = (ignoreConflict: boolean) => {
          if (table === assets && rowsOf(assets).some((row) => row.symbol === value.symbol)) {
            if (ignoreConflict) return;
            throw new Error("duplicate symbol");
          }
          rowsOf(table).push({ id: mocks.nextId.value++, ...value });
        };
        return {
          onConflictDoNothing: () => thenable(() => insert(true)),
          onConflictDoUpdate: () => thenable(() => insert(true)),
          ...thenable(() => insert(false)),
        };
      },
    };
  },
  update(table: unknown) {
    return {
      set(patch: Row) {
        return {
          where: (condition: Condition) => thenable(() => {
            for (const row of rowsOf(table)) if (matches(row, table, condition)) Object.assign(row, patch);
          }),
        };
      },
    };
  },
  async transaction<T>(callback: (tx: unknown) => Promise<T>): Promise<T> {
    const saved = new Map([...mocks.tables].map(([table, rows]) => [table, rows.map((row) => ({ ...row }))]));
    try {
      return await callback(fakeDb);
    } catch (error) {
      mocks.tables.clear();
      for (const [table, rows] of saved) mocks.tables.set(table, rows);
      throw error;
    }
  },
};

const {
  applyConfiguredMappings,
  applyPendingSplits,
  executeCorporateAction,
  listCorporateActionBook,
} = await import("@/lib/applyCorporateActions");
const { GET, POST } = await import("@/app/api/admin/corporate-actions/route");

function asset(id: number, symbol: string, extra: Row = {}): Row {
  return { id, symbol, name: `${symbol} Inc`, type: "equity", priceSource: "yahoo", sourceId: symbol, quoteCurrency: "USD", ...extra };
}

function position(id: number, playerId: number, assetId: number, extra: Row = {}): Row {
  return { id, playerId, assetId, quantity: 10, startPrice: 100, allocation: 1000, isMvp: false, pickIndex: id, ...extra };
}

function positionRow(id: number): Row {
  return rowsOf(positions).find((row) => row.id === id)!;
}

function storedLog() {
  const row = rowsOf(assets).find((item) => item.symbol === "__CORP_ACTIONS__");
  return row ? parseActionLog(String(row.name)) : emptyActionLog();
}

function post(body: unknown): Request {
  return new Request("http://localhost/api/admin/corporate-actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const EX_DATE = Date.parse("2026-07-20T00:00:00Z") / 1000;

beforeEach(() => {
  mocks.tables.clear();
  mocks.nextId.value = 100;
  mocks.mappings.length = 0;
  rowsOf(players).push({ id: 10, name: "Ada" }, { id: 11, name: "Grace" });
  rowsOf(assets).push(asset(5, "ACME"), asset(9, "BUYER"), asset(1, "CASH", { type: "cash", priceSource: "none", sourceId: "" }));
  rowsOf(positions).push(position(1, 10, 5), position(2, 10, 9), position(3, 11, 5));
});

describe("fix 2: merger-map splits apply once", () => {
  it("does not re-apply a configured split on every request", async () => {
    const mapping: MergerMapping = { from: "ACME", kind: "split", ratio: 2, effectiveDate: "2026-07-20" };
    mocks.mappings.push(mapping);

    await applyConfiguredMappings();
    await applyConfiguredMappings();
    await applyConfiguredMappings();

    expect(positionRow(1)).toMatchObject({ quantity: 20, startPrice: 50 });
    expect(positionRow(3)).toMatchObject({ quantity: 20, startPrice: 50 });
    const log = storedLog();
    expect(log.appliedActionIds).toEqual(["map:split:ACME:2026-07-20:2"]);
    expect(log.appliedSplitsByPosition["1"].map((split) => split.id)).toEqual(["map:split:ACME:2026-07-20:2"]);
    expect(log.revision).toBe(1);
  });

  it("records the mapping without re-splitting when an admin already applied it", async () => {
    await executeCorporateAction({ kind: "split", symbol: "ACME", ratio: 2, effectiveAt: EX_DATE });
    mocks.mappings.push({ from: "ACME", kind: "split", ratio: 2, effectiveDate: "2026-07-20" });

    await applyConfiguredMappings();

    expect(positionRow(1).quantity).toBe(20);
    expect(storedLog().appliedActionIds).toContain("map:split:ACME:2026-07-20:2");
  });
});

describe("fix 3: conversion when the player already holds the acquirer", () => {
  it("moves the converted pick onto a separate successor row", async () => {
    const { summary } = await executeCorporateAction({ kind: "stock", symbol: "ACME", acquirerSymbol: "BUYER", ratio: 0.5 });

    const successor = rowsOf(assets).find((row) => row.symbol === "BUYER~ACME")!;
    expect(successor).toMatchObject({ sourceId: "BUYER", priceSource: "yahoo", type: "equity" });
    expect(positionRow(1)).toMatchObject({ assetId: successor.id, quantity: 5, startPrice: 200, allocation: 1000 });
    // Ada's own BUYER pick is untouched; Grace moves onto the shared listing.
    expect(positionRow(2)).toMatchObject({ assetId: 9, quantity: 10 });
    expect(positionRow(3)).toMatchObject({ assetId: 9, quantity: 5 });
    expect(storedLog().lineageByPosition["1"]).toEqual([5]);
    expect(summary).toMatch(/BUYER~ACME/);
  });
});

describe("fix 4: split idempotency", () => {
  it("refuses a manual split Yahoo already applied", async () => {
    await applyPendingSplits(new Map([["ACME", [{ id: "1784505600", date: EX_DATE + 3600, numerator: 2, denominator: 1 }]]]));
    expect(positionRow(1).quantity).toBe(20);

    await expect(executeCorporateAction({ kind: "split", symbol: "ACME", ratio: 2, effectiveAt: EX_DATE }))
      .rejects.toBeInstanceOf(AlreadyAppliedError);
    expect(positionRow(1).quantity).toBe(20);
  });

  it("does not let Yahoo re-apply a split an admin recorded weeks late", async () => {
    await executeCorporateAction({ kind: "split", symbol: "ACME", ratio: 2, effectiveAt: EX_DATE });
    await applyPendingSplits(new Map([["ACME", [{ id: "1784505600", date: EX_DATE + 3600, numerator: 2, denominator: 1 }]]]));
    expect(positionRow(1).quantity).toBe(20);
  });

  it("treats a double submit with the same request id as a no-op", async () => {
    await executeCorporateAction({ kind: "split", symbol: "ACME", ratio: 2, effectiveAt: EX_DATE, requestId: "req-1" });
    const again = await executeCorporateAction({ kind: "split", symbol: "ACME", ratio: 2, effectiveAt: EX_DATE, requestId: "req-1" });
    expect(again.summary).toMatch(/already recorded/i);
    expect(positionRow(1).quantity).toBe(20);
  });
});

describe("fix 6: caches drop after a corporate action", () => {
  it("clears cached quotes and bumps the revision they are keyed by", async () => {
    writeQuoteCache("standings:prices", 0, new Map());
    writeQuoteCache("intraday:1d", 0, {});
    await executeCorporateAction({ kind: "split", symbol: "ACME", ratio: 2, effectiveAt: EX_DATE });
    expect(readQuoteCache("standings:prices", 0, 60_000)).toBeNull();
    expect(readQuoteCache("intraday:1d", 0, 60_000)).toBeNull();
    expect(storedLog().revision).toBe(1);
  });
});

describe("fix 9: admin form cannot undo an action with stale quantities", () => {
  it("returns the fresh book with the result", async () => {
    const response = await POST(post({ kind: "stock", symbol: "ACME", acquirerSymbol: "BUYER", ratio: 0.5, requestId: "a" }));
    expect(response.status).toBe(200);
    const body = await response.json() as { book: { revision: number; positions: { positionId: number; quantity: number }[] } };
    expect(body.book.positions.find((row) => row.positionId === 1)?.quantity).toBe(5);
    expect(body.book.revision).toBe(1);
  });

  it("rejects an edit made against an older revision", async () => {
    const before = await listCorporateActionBook();
    await executeCorporateAction({ kind: "stock", symbol: "ACME", acquirerSymbol: "BUYER", ratio: 0.5 });

    const response = await POST(post({
      kind: "edit",
      positionId: 1,
      quantity: 10,
      startPrice: 100,
      expectedRevision: before.revision,
    }));
    expect(response.status).toBe(409);
    expect(positionRow(1)).toMatchObject({ quantity: 5, startPrice: 200 });
  });
});

describe("fix 14: the admin book always shows MVP picks", () => {
  it("returns isMvp even though no player has locked every MVP", async () => {
    positionRow(1).isMvp = true;
    const response = await GET();
    const body = await response.json() as { positions: { positionId: number; isMvp: boolean }[] };
    expect(body.positions.find((row) => row.positionId === 1)?.isMvp).toBe(true);
    expect(body.positions.find((row) => row.positionId === 3)?.isMvp).toBe(false);
  });
});

describe("fixes 7, 10 and 12 through the admin route", () => {
  it("accepts a 1:30 reverse split", async () => {
    const response = await POST(post({ kind: "split", symbol: "ACME", ratio: "1:30", effectiveDate: "2026-07-20" }));
    expect(response.status).toBe(200);
    expect(positionRow(1).quantity).toBeCloseTo(1 / 3);
    expect(positionRow(1).startPrice).toBeCloseTo(3000);
  });

  it("rejects a split ratio of 1 or one beyond 1-for-1000 with a 400", async () => {
    expect((await POST(post({ kind: "split", symbol: "ACME", ratio: 1 }))).status).toBe(400);
    expect((await POST(post({ kind: "split", symbol: "ACME", ratio: "1:5000" }))).status).toBe(400);
    expect(positionRow(1).quantity).toBe(10);
  });

  it("records the deal's effective date, and rejects a future one", async () => {
    await POST(post({ kind: "stock", symbol: "ACME", acquirerSymbol: "NEWCO", ratio: 2, effectiveDate: "2026-07-15" }));
    const effective = Date.parse("2026-07-15T00:00:00Z") / 1000;
    expect(storedLog().splitsAfterByPosition["1"]).toBe(effective);
    expect(storedLog().effectiveAtByPosition["1"]).toBe(effective);

    const future = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    expect((await POST(post({ kind: "cash", symbol: "BUYER", cashPerShare: 5, effectiveDate: future }))).status).toBe(400);
  });

  it("rejects a stock conversion into cash", async () => {
    const response = await POST(post({ kind: "stock", symbol: "ACME", acquirerSymbol: "CASH", ratio: 1 }));
    expect(response.status).toBe(400);
    expect(positionRow(1)).toMatchObject({ assetId: 5, quantity: 10 });
  });
});

describe("fix 11: a corrupted log is never overwritten", () => {
  beforeEach(() => {
    rowsOf(assets).push(asset(50, "__CORP_ACTIONS__", { name: "{\"appliedSplitsByPosition\": {\"1\": \"oops", type: "system" }));
  });

  it("blocks writes and leaves the stored payload untouched", async () => {
    await expect(executeCorporateAction({ kind: "split", symbol: "ACME", ratio: 2, effectiveAt: EX_DATE }))
      .rejects.toBeInstanceOf(CorruptActionLogError);
    await expect(applyPendingSplits(new Map([["ACME", [{ id: "e", date: EX_DATE, numerator: 2, denominator: 1 }]]])))
      .rejects.toBeInstanceOf(CorruptActionLogError);

    expect(rowsOf(assets).find((row) => row.id === 50)?.name).toBe("{\"appliedSplitsByPosition\": {\"1\": \"oops");
    expect(positionRow(1).quantity).toBe(10);
  });

  it("surfaces the error to the admin panel", async () => {
    const book = await listCorporateActionBook();
    expect(book.revision).toBeNull();
    expect(book.logError).toMatch(/not valid JSON/);
  });
});
