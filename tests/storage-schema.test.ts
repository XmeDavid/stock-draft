import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Sites D1 migration", () => {
  const sql = readFileSync(new URL("../drizzle/0000_regular_havok.sql", import.meta.url), "utf8");

  it("creates every durable game table", () => {
    for (const table of ["races", "players", "assets", "positions", "snapshots"]) {
      expect(sql).toContain(`CREATE TABLE \`${table}\``);
    }
  });

  it("protects usernames, picks, and daily snapshots with unique indexes", () => {
    expect(sql).toContain("players_username_unique");
    expect(sql).toContain("positions_player_asset_unique");
    expect(sql).toContain("snapshots_player_date_unique");
  });
});
