import { describe, it, expect } from "vitest";
import { computeQuantity, portfolioValue, percentGain, positionValue } from "@/lib/valuation";

describe("computeQuantity", () => {
  it("divides allocation by price", () => {
    expect(computeQuantity(5000, 100)).toBe(50);
  });
  it("handles fractional quantities (crypto)", () => {
    expect(computeQuantity(1000, 30000)).toBeCloseTo(0.033333, 5);
  });
  it("throws on zero or negative price", () => {
    expect(() => computeQuantity(1000, 0)).toThrow();
    expect(() => computeQuantity(1000, -5)).toThrow();
  });
});

describe("positionValue", () => {
  it("doubles an MVP's profit and loss while preserving its starting value", () => {
    expect(positionValue(10, 100, 1000, true)).toBe(1000);
    expect(positionValue(10, 120, 1000, true)).toBe(1400);
    expect(positionValue(10, 80, 1000, true)).toBe(600);
  });

  it("floors an MVP position at zero", () => {
    expect(positionValue(10, 40, 1000, true)).toBe(0);
  });

  it("leaves ordinary positions unchanged", () => {
    expect(positionValue(10, 120, 1000, false)).toBe(1200);
  });
});

describe("portfolioValue", () => {
  it("sums quantity * price", () => {
    expect(
      portfolioValue([
        { quantity: 50, price: 110 },
        { quantity: 2, price: 1000 },
      ])
    ).toBe(7500);
  });
  it("is 0 for empty portfolio", () => {
    expect(portfolioValue([])).toBe(0);
  });
});

describe("percentGain", () => {
  it("computes gain", () => {
    expect(percentGain(11000, 10000)).toBeCloseTo(10);
  });
  it("computes loss", () => {
    expect(percentGain(9000, 10000)).toBeCloseTo(-10);
  });
});
