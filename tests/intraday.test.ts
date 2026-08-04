import { describe, expect, it } from "vitest";
import { buildGrid, buildIntradayHistory, resampleOnGrid } from "@/lib/intraday";

const HOUR = 3_600_000;
const MIN = 60_000;

describe("buildGrid", () => {
  it("covers the last 24h in 15-minute steps for 1d", () => {
    const now = Date.parse("2026-08-04T10:07:00Z");
    const grid = buildGrid(now, "1d");
    expect(grid[0]).toBe(Date.parse("2026-08-03T10:00:00Z"));
    expect(grid.at(-1)).toBe(Date.parse("2026-08-04T10:00:00Z"));
    expect(grid[1]! - grid[0]!).toBe(15 * MIN);
  });

  it("covers the last 7 days hourly for 1w", () => {
    const now = Date.parse("2026-08-04T10:59:00Z");
    const grid = buildGrid(now, "1w");
    expect(grid[0]).toBe(Date.parse("2026-07-28T10:00:00Z"));
    expect(grid.at(-1)).toBe(Date.parse("2026-08-04T10:00:00Z"));
    expect(grid[1]! - grid[0]!).toBe(HOUR);
  });
});

describe("resampleOnGrid", () => {
  const grid = [0, HOUR, 2 * HOUR, 3 * HOUR];

  it("forward-fills the most recent price at each grid point", () => {
    const points = [
      { t: 0, price: 10 },
      { t: HOUR + MIN, price: 12 },
    ];
    expect(resampleOnGrid(points, grid)).toEqual([10, 10, 12, 12]);
  });

  it("backfills from the first point before the series starts", () => {
    const points = [{ t: 2 * HOUR, price: 7 }];
    expect(resampleOnGrid(points, grid)).toEqual([7, 7, 7, 7]);
  });

  it("handles unsorted input", () => {
    const points = [
      { t: 2 * HOUR, price: 20 },
      { t: 0, price: 10 },
    ];
    expect(resampleOnGrid(points, grid)).toEqual([10, 10, 20, 20]);
  });
});

describe("buildIntradayHistory", () => {
  it("sums positions per player at each grid point with MVP doubling", () => {
    const grid = [0, HOUR];
    const prices = new Map([
      ["yahoo:AAPL", [100, 110]],
      ["none:CASH", [1, 1]],
    ]);
    const players = [{
      id: 7,
      positions: [
        // 10 shares bought at 100 with a 1000 allocation, MVP: profit doubles.
        { assetKey: "yahoo:AAPL", quantity: 10, allocation: 1000, isMvp: true },
        { assetKey: "none:CASH", quantity: 500, allocation: 500, isMvp: false },
      ],
    }];
    const rows = buildIntradayHistory(players, prices, grid);
    expect(rows).toEqual([
      { date: "1970-01-01T00:00:00.000Z", "7": 1500 },
      { date: "1970-01-01T01:00:00.000Z", "7": 1700 },
    ]);
  });

  it("skips assets with no price row instead of producing NaN", () => {
    const rows = buildIntradayHistory(
      [{ id: 1, positions: [{ assetKey: "yahoo:GONE", quantity: 1, allocation: 100, isMvp: false }] }],
      new Map(),
      [0]
    );
    expect(rows).toEqual([{ date: "1970-01-01T00:00:00.000Z", "1": 0 }]);
  });
});
