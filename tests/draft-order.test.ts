import { describe, expect, it } from "vitest";
import { turnFor } from "@/lib/draftOrder";

describe("turnFor", () => {
  const order = [10, 20, 30, 40];

  it("uses a snake order", () => {
    expect([0, 1, 2, 3].map((index) => turnFor(order, index))).toEqual([10, 20, 30, 40]);
    expect([4, 5, 6, 7].map((index) => turnFor(order, index))).toEqual([40, 30, 20, 10]);
    expect(turnFor(order, 8)).toBe(10);
  });

  it("rejects an empty order", () => {
    expect(() => turnFor([], 0)).toThrow("Draft order is empty");
  });
});
