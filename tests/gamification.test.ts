import { describe, expect, it } from "vitest";
import { buildWeeklyMatchups, daysLed, pairingsForWeek, personalityFor, ranksForValues } from "@/lib/gamification";

describe("gamification", () => {
  it("calculates ranks and credits tied daily leaders", () => {
    expect(ranksForValues([
      { playerId: 1, value: 9000 },
      { playerId: 2, value: 11000 },
    ]).get(2)).toBe(1);
    const led = daysLed([
      { playerId: 1, date: new Date("2026-08-01"), totalValue: 11000 },
      { playerId: 2, date: new Date("2026-08-01"), totalValue: 11000 },
      { playerId: 1, date: new Date("2026-08-02"), totalValue: 10000 },
      { playerId: 2, date: new Date("2026-08-02"), totalValue: 12000 },
    ]);
    expect(led.get(1)).toBe(1);
    expect(led.get(2)).toBe(2);
  });

  it("rotates weekly opponents without duplicating players", () => {
    const players = [1, 2, 3, 4].map((id) => ({ id, name: `P${id}` }));
    expect(pairingsForWeek(players, 1)).toHaveLength(2);
    const weekTwo = pairingsForWeek(players, 2).flat().map((player) => player.id);
    expect(new Set(weekTwo).size).toBe(4);
  });

  it("assigns a portfolio personality", () => {
    expect(personalityFor(["crypto", "crypto", "crypto", "crypto", "equity"])).toBe("Crypto Maximalist");
    expect(personalityFor(["equity", "etf", "crypto"])).toBe("Chaos Diversifier");
  });

  it("includes the race-start day in the first weekly return", () => {
    const players = [{ id: 1, name: "Ana" }, { id: 2, name: "Bo" }];
    const points = [
      { playerId: 1, date: new Date("2026-08-03T00:00:00Z"), totalValue: 10000 },
      { playerId: 1, date: new Date("2026-08-09T00:00:00Z"), totalValue: 11000 },
      { playerId: 2, date: new Date("2026-08-03T00:00:00Z"), totalValue: 10000 },
      { playerId: 2, date: new Date("2026-08-09T00:00:00Z"), totalValue: 9000 },
    ];
    const [matchup] = buildWeeklyMatchups(
      players,
      points,
      new Date("2026-08-03T15:30:00Z"),
      new Date("2026-08-10T15:30:00Z")
    );
    expect(matchup.returnA).toBeCloseTo(10);
    expect(matchup.returnB).toBeCloseTo(-10);
    expect(matchup.winnerId).toBe(1);
  });
});
