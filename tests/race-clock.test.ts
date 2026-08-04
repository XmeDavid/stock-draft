import { describe, expect, it } from "vitest";
import { latestSnapshotCutoff, parseSnapshotHours } from "@/lib/raceClock";

describe("parseSnapshotHours", () => {
  it("parses a comma-separated list, sorted and deduped", () => {
    expect(parseSnapshotHours("18,12, 12")).toEqual([12, 18]);
  });

  it("defaults to 18:00 UTC", () => {
    expect(parseSnapshotHours(undefined)).toEqual([18]);
    expect(parseSnapshotHours("")).toEqual([18]);
  });

  it("ignores invalid entries", () => {
    expect(parseSnapshotHours("9,x,24,-1")).toEqual([9]);
    expect(parseSnapshotHours("x")).toEqual([18]);
  });
});

describe("latestSnapshotCutoff", () => {
  const hours = [12, 18];

  it("uses the most recent passed hour today", () => {
    expect(latestSnapshotCutoff(new Date("2026-08-04T13:05:00Z"), hours))
      .toEqual(new Date("2026-08-04T12:00:00Z"));
    expect(latestSnapshotCutoff(new Date("2026-08-04T23:59:00Z"), hours))
      .toEqual(new Date("2026-08-04T18:00:00Z"));
  });

  it("falls back to yesterday's last hour before any cutoff has passed today", () => {
    expect(latestSnapshotCutoff(new Date("2026-08-04T09:00:00Z"), hours))
      .toEqual(new Date("2026-08-03T18:00:00Z"));
  });

  it("treats the exact cutoff instant as passed", () => {
    expect(latestSnapshotCutoff(new Date("2026-08-04T12:00:00Z"), hours))
      .toEqual(new Date("2026-08-04T12:00:00Z"));
  });
});
