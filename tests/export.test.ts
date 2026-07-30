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
