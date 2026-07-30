import { describe, expect, it } from "vitest";
import { formatChartDate, formatEuropeanDate } from "@/lib/dateFormat";

describe("European date formatting", () => {
  it("formats ISO dates day first", () => {
    expect(formatEuropeanDate("2026-07-30")).toBe("30/07/2026");
  });

  it("formats chart dates while preserving live labels", () => {
    expect(formatChartDate("2026-12-01")).toBe("01/12/2026");
    expect(formatChartDate("Live")).toBe("Live");
  });
});
