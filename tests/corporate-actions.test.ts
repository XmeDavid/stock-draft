import { describe, expect, it } from "vitest";
import { positionValue } from "@/lib/valuation";
import {
  applyRatio,
  buildSnapshotRow,
  cumulativeSplitFactor,
  findBreakdownRow,
  historicalAssetIds,
  planCashBuyout,
  planEdit,
  planSplit,
  planStockConversion,
  resolvePositionQuote,
  splitsFromChart,
  tickerKey,
  unappliedSplits,
  unpricedHint,
  type Holding,
  type Listing,
  type YahooSplit,
} from "@/lib/corporateActions";

const now = new Date("2026-08-01T15:00:00Z");

function holding(overrides: Partial<Holding> = {}): Holding {
  return {
    positionId: 1,
    playerId: 10,
    playerName: "Ada",
    assetId: 5,
    symbol: "ACME",
    name: "Acme Corp",
    type: "equity",
    priceSource: "yahoo",
    sourceId: "ACME",
    quoteCurrency: "USD",
    quantity: 10,
    startPrice: 100,
    allocation: 1000,
    isMvp: false,
    ...overrides,
  };
}

function listing(overrides: Partial<Listing> = {}): Listing {
  return {
    id: 5,
    symbol: "ACME",
    name: "Acme Corp",
    type: "equity",
    priceSource: "yahoo",
    sourceId: "ACME",
    quoteCurrency: "USD",
    ...overrides,
  };
}

describe("delisted ticker mid-race", () => {
  it("keeps the last snapshot and flags a corporate action instead of pretending the start price is live", () => {
    const row = buildSnapshotRow({
      assetId: 5,
      symbol: "ACME",
      quantity: 20,
      allocation: 1000,
      isMvp: true,
      startPrice: 50,
      priceSource: "yahoo",
      type: "equity",
      live: { error: "yahoo ACME: HTTP 404: No data found, symbol may be delisted" },
      lastSnapshotPrice: 80,
    });

    expect(row.pricingStatus).toBe("unpriced");
    expect(row.possibleCorporateAction).toBe(true);
    expect(row.priceBasis).toBe("last-snapshot");
    expect(row.price).toBe(80);
    // 20 shares at the last real print, with MVP leverage. The start price would have scored this as flat.
    expect(row.value).toBe(positionValue(20, 80, 1000, true));
    expect(row.value).toBe(2200);
    expect(positionValue(20, 50, 1000, true)).toBe(1000);
  });

  it("flags a start-price placeholder when the ticker dies before any snapshot exists", () => {
    const quote = resolvePositionQuote({
      live: { error: "yahoo ACME: timeout" },
      lastSnapshotPrice: null,
      startPrice: 50,
      priceSource: "yahoo",
    });
    expect(quote.pricingStatus).toBe("unpriced");
    expect(quote.possibleCorporateAction).toBe(true);
    expect(quote.priceBasis).toBe("start");
    expect(quote.price).toBe(50);
    expect(unpricedHint("ACME", [])).toMatch(/last known value/i);
  });
});

describe("stock-for-stock conversion", () => {
  it("rolls the original allocation forward and measures gain from it", () => {
    const drafted = holding({ isMvp: true });
    const plan = planStockConversion([drafted], [listing()], {
      symbol: "ACME",
      acquirerSymbol: "BUYER",
      ratio: 0.5,
      acquirerName: "Buyer Inc",
      now,
    });

    expect(plan.assetPatch).toMatchObject({
      assetId: 5,
      symbol: "BUYER",
      name: "Buyer Inc",
      sourceId: "BUYER",
      priceSource: "yahoo",
    });
    const patch = plan.positionPatches[0];
    expect(patch.assetId).toBe(5);
    expect(patch.quantity).toBe(5);
    expect(patch.startPrice).toBe(200);
    expect(patch.allocation).toBeUndefined();
    expect(patch.quantity * patch.startPrice).toBeCloseTo(drafted.allocation);

    const acquirerPrice = 220;
    expect(positionValue(patch.quantity, acquirerPrice, drafted.allocation, false)).toBe(1100);
    expect(positionValue(patch.quantity, acquirerPrice, drafted.allocation, true)).toBe(1200);
  });
});

describe("cash buyout", () => {
  it("turns the position into fixed cash and keeps doubling an MVP's gain", () => {
    const drafted = holding({ isMvp: true });
    const plan = planCashBuyout([drafted], [listing()], "ACME", 150);
    const patch = plan.positionPatches[0];

    expect(plan.assetPatch).toMatchObject({
      symbol: "ACME",
      type: "cash",
      priceSource: "none",
      name: "Acme Corp (cash buyout)",
    });
    expect(patch.quantity).toBe(1500);
    expect(patch.quantity * 1).toBe(1500);
    expect(positionValue(patch.quantity, 1, drafted.allocation, false)).toBe(1500);
    expect(positionValue(patch.quantity, 1, drafted.allocation, true)).toBe(2000);

    const quote = resolvePositionQuote({
      live: { error: "yahoo ACME: HTTP 404" },
      lastSnapshotPrice: null,
      startPrice: patch.startPrice,
      priceSource: "none",
    });
    expect(quote.priceBasis).toBe("cash");
    expect(quote.possibleCorporateAction).toBe(false);
    expect(quote.price).toBe(1);
  });
});

describe("split adjustment", () => {
  it("keeps an MVP whole when the post-split price is half", () => {
    const drafted = holding({ isMvp: true });
    const unadjusted = positionValue(drafted.quantity, 50, drafted.allocation, true);
    expect(unadjusted).toBe(0);

    const plan = planSplit([drafted], "ACME", 2);
    const patch = plan.positionPatches[0];
    expect(patch.quantity).toBe(20);
    expect(patch.startPrice).toBe(50);
    expect(patch.quantity * patch.startPrice).toBeCloseTo(drafted.allocation);
    expect(positionValue(patch.quantity, 50, drafted.allocation, true)).toBe(1000);
    expect(positionValue(patch.quantity, 55, drafted.allocation, true)).toBe(1200);
    expect(applyRatio(10, 100, 2)).toEqual({ quantity: 20, startPrice: 50 });
  });

  it("applies a Yahoo split once and does not repeat an admin split of the same ratio", () => {
    const splits: YahooSplit[] = [
      { id: "1717214400", date: 1_718_026_200, numerator: 10, denominator: 1 },
    ];
    expect(cumulativeSplitFactor(splits, 1_700_000_000)).toBe(10);
    expect(cumulativeSplitFactor(splits, 1_718_026_200)).toBe(1);

    const first = unappliedSplits(splits, 1_700_000_000, []);
    expect(first.map((split) => split.id)).toEqual(["1717214400"]);
    const applied = [{ id: "1717214400", date: 1_718_026_200, ratio: 10 }];
    expect(unappliedSplits(splits, 1_700_000_000, applied)).toEqual([]);

    const admin = [{ id: "admin:1:1718020000:10", date: 1_718_020_000, ratio: 10 }];
    expect(unappliedSplits(splits, 1_700_000_000, admin)).toEqual([]);
    const otherRatio = [{ id: "admin:1:1718020000:2", date: 1_718_020_000, ratio: 2 }];
    expect(unappliedSplits(splits, 1_700_000_000, otherRatio).map((split) => split.numerator / split.denominator)).toEqual([10]);
  });
});

describe("acquirer already held by another player", () => {
  it("lets both players hold the acquirer without merging them or reapplying the draft rule", () => {
    const target = holding({ positionId: 1, playerId: 10, playerName: "Ada", isMvp: true });
    const acquirer = holding({
      positionId: 2,
      playerId: 11,
      playerName: "Grace",
      assetId: 9,
      symbol: "BUYER",
      name: "Buyer Inc",
      sourceId: "BUYER",
      quantity: 4,
      startPrice: 250,
      allocation: 1000,
    });
    const listings = [
      listing(),
      listing({ id: 9, symbol: "BUYER", name: "Buyer Inc", sourceId: "BUYER" }),
    ];
    const plan = planStockConversion([target, acquirer], listings, {
      symbol: "ACME",
      acquirerSymbol: "BUYER",
      ratio: 0.5,
      now,
    });

    expect(plan.assetPatch).toBeNull();
    expect(plan.positionPatches).toHaveLength(1);
    expect(plan.positionPatches[0]).toMatchObject({
      positionId: 1,
      assetId: 9,
      previousAssetId: 5,
      quantity: 5,
      startPrice: 200,
    });
    expect(plan.positionPatches.some((patch) => patch.positionId === acquirer.positionId)).toBe(false);

    const oldRow = { assetId: 5, price: 100, value: 1000 };
    expect(findBreakdownRow([oldRow], historicalAssetIds(9, [5]))).toBe(oldRow);
  });

  it("refuses to fold two of one player's picks into a single listing", () => {
    const target = holding({ positionId: 1, playerId: 10, playerName: "Ada" });
    const already = holding({
      positionId: 2,
      playerId: 10,
      playerName: "Ada",
      assetId: 9,
      symbol: "BUYER",
      name: "Buyer Inc",
      sourceId: "BUYER",
    });
    expect(() => planStockConversion(
      [target, already],
      [listing(), listing({ id: 9, symbol: "BUYER", name: "Buyer Inc", sourceId: "BUYER" })],
      { symbol: "ACME", acquirerSymbol: "BUYER", ratio: 1, now },
    )).toThrow(/already holds BUYER/);
  });
});

describe("position edits and ticker identity", () => {
  it("edits quantity without touching the allocation unless asked", () => {
    const plan = planEdit([holding()], { positionId: 1, quantity: 12 });
    expect(plan.positionPatches[0]).toMatchObject({ quantity: 12, startPrice: 100, allocation: 1000 });
  });

  it("treats BRK.B and BRK-B as the same ticker", () => {
    expect(tickerKey("BRK.B")).toBe(tickerKey("BRK-B"));
  });

  it("reads a Yahoo split event from the chart payload", () => {
    const splits = splitsFromChart({
      chart: {
        result: [{
          events: {
            splits: {
              "1717214400": { date: 1718026200, numerator: 10, denominator: 1, splitRatio: "10:1" },
            },
          },
        }],
      },
    });
    expect(splits).toEqual([{ id: "1717214400", date: 1718026200, numerator: 10, denominator: 1 }]);
  });
});
