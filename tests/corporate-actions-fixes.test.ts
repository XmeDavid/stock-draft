import { describe, expect, it } from "vitest";
import { positionValue } from "@/lib/valuation";
import {
  AlreadyAppliedError,
  CorruptActionLogError,
  adminSplitRecord,
  assertSplitRatio,
  emptyActionLog,
  implausibleSplits,
  isCleanSplitRatio,
  lastKnownPriceFor,
  mappingActionId,
  parseActionLog,
  parseEffectiveDate,
  planFromMapping,
  planSplit,
  planStockConversion,
  resolvePositionQuote,
  unappliedSplits,
  unpricedHint,
  type Holding,
  type Listing,
  type YahooSplit,
} from "@/lib/corporateActions";
import { buildIntradayHistory } from "@/lib/intraday";
import { clearQuoteCaches, readQuoteCache, writeQuoteCache } from "@/lib/quoteCache";

const now = new Date("2026-08-01T15:00:00Z");
const DAY = 24 * 60 * 60;

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

describe("fix 1: fallback price restated in the current share count", () => {
  const history = [{
    playerId: 10,
    capturedAt: new Date("2026-07-31T18:00:00Z"),
    breakdown: [{ positionId: 1, assetId: 5, price: 120, quantity: 10 }],
  }];

  it("divides by the conversion ratio so a converted MVP keeps its value", () => {
    // 10 shares at 120, converted at 0.5 into 5 shares: the fallback is 240, not 120.
    const price = lastKnownPriceFor(history, { playerId: 10, positionId: 1, assetIds: [9, 5], quantity: 5 });
    expect(price).toBe(240);
    expect(positionValue(5, price!, 1000, true)).toBe(positionValue(10, 120, 1000, true));
  });

  it("divides by a split ratio, including a 1-for-30 reverse split", () => {
    expect(lastKnownPriceFor(history, { playerId: 10, positionId: 1, assetIds: [5], quantity: 20 })).toBe(60);
    expect(lastKnownPriceFor(history, { playerId: 10, positionId: 1, assetIds: [5], quantity: 1 / 3 })).toBeCloseTo(3600);
  });

  it("is per position: another pick on the same listing does not borrow this one's row", () => {
    const shared = [{
      playerId: 10,
      breakdown: [
        { positionId: 1, assetId: 9, price: 240, quantity: 5 },
        { positionId: 2, assetId: 9, price: 999, quantity: 1 },
      ],
    }];
    expect(lastKnownPriceFor(shared, { playerId: 10, positionId: 2, assetIds: [9], quantity: 1 })).toBe(999);
    expect(lastKnownPriceFor(shared, { playerId: 10, positionId: 1, assetIds: [9], quantity: 5 })).toBe(240);
  });

  it("falls back to asset lineage for rows written before position ids were stored", () => {
    const legacy = [{ playerId: 10, breakdown: [{ assetId: 5, price: 100, quantity: 10 }] }];
    expect(lastKnownPriceFor(legacy, { playerId: 10, positionId: 1, assetIds: [9, 5], quantity: 2.5 })).toBe(400);
  });
});

describe("fix 2: merger-map splits have a stable id and apply once", () => {
  const mapping = { from: "ACME", kind: "split" as const, ratio: 2, effectiveDate: "2026-07-20" };

  it("derives the same id every time", () => {
    expect(mappingActionId(mapping)).toBe("map:split:ACME:2026-07-20:2");
    expect(mappingActionId({ ...mapping })).toBe(mappingActionId(mapping));
    expect(mappingActionId({ ...mapping, ratio: 3 })).not.toBe(mappingActionId(mapping));
  });

  it("refuses to apply a mapped split the position already reflects", () => {
    const first = planFromMapping([holding()], [listing()], mapping, now, emptyActionLog());
    const record = first.positionPatches[0].splitRecord!;
    expect(record.id).toBe("map:split:ACME:2026-07-20:2");
    const log = { ...emptyActionLog(), appliedSplitsByPosition: { "1": [record] } };
    expect(() => planFromMapping([holding({ quantity: 20 })], [listing()], mapping, now, log)).toThrow(AlreadyAppliedError);
  });
});

describe("fix 3: successor rows", () => {
  it("refuses a second conversion into a successor row the player already holds", () => {
    expect(() => planStockConversion(
      [
        holding({ positionId: 1, playerId: 10, assetId: 7, symbol: "ACME" }),
        holding({ positionId: 2, playerId: 10, assetId: 9, symbol: "BUYER", sourceId: "BUYER" }),
        holding({ positionId: 3, playerId: 10, assetId: 12, symbol: "BUYER~ACME", sourceId: "BUYER" }),
      ],
      [
        listing({ id: 7 }),
        listing({ id: 9, symbol: "BUYER", sourceId: "BUYER" }),
        listing({ id: 12, symbol: "BUYER~ACME", sourceId: "BUYER" }),
      ],
      { symbol: "ACME", acquirerSymbol: "BUYER", ratio: 1, now },
    )).toThrow(/already holds BUYER~ACME/);
  });

  it("splits successor rows along with the acquirer they are quoted off", () => {
    const plan = planSplit([
      holding({ positionId: 2, assetId: 9, symbol: "BUYER", sourceId: "BUYER" }),
      holding({ positionId: 3, assetId: 12, symbol: "BUYER~ACME", sourceId: "BUYER" }),
    ], "BUYER", 2);
    expect(plan.positionPatches.map((patch) => patch.positionId)).toEqual([2, 3]);
  });
});

describe("fix 4: split dedupe across manual, mapped and Yahoo entries", () => {
  const exDate = 1_718_026_200;

  it("refuses a manual split that Yahoo already applied", () => {
    const log = {
      ...emptyActionLog(),
      appliedSplitsByPosition: { "1": [{ id: "1717214400", date: exDate, ratio: 10 }] },
    };
    expect(() => planSplit([holding()], "ACME", 10, { date: exDate - DAY, log })).toThrow(AlreadyAppliedError);
  });

  it("refuses a manual split already recorded from the merger map", () => {
    const log = {
      ...emptyActionLog(),
      appliedSplitsByPosition: { "1": [{ id: "map:split:ACME:2024-06-10:10", date: exDate, ratio: 10 }] },
    };
    expect(() => planSplit([holding()], "ACME", 10, { date: exDate, log })).toThrow(/already reflected/);
  });

  it("gives a resubmitted manual split the same id so it is recognised", () => {
    expect(adminSplitRecord("acme", 2, exDate).id).toBe(adminSplitRecord("ACME", 2, exDate + 60).id);
    const record = adminSplitRecord("ACME", 2, exDate);
    const log = { ...emptyActionLog(), appliedSplitsByPosition: { "1": [record] } };
    expect(() => planSplit([holding()], "ACME", 2, { date: exDate, log })).toThrow(AlreadyAppliedError);
  });

  it("matches on the entered ex-date, so an admin split recorded weeks late still suppresses Yahoo", () => {
    const yahoo: YahooSplit[] = [{ id: "1717214400", date: exDate, numerator: 2, denominator: 1 }];
    const late = [adminSplitRecord("ACME", 2, exDate)];
    expect(unappliedSplits(yahoo, exDate - 30 * DAY, late)).toEqual([]);
  });

  it("only splits the positions that still need it", () => {
    const log = {
      ...emptyActionLog(),
      appliedSplitsByPosition: { "1": [{ id: "y", date: exDate, ratio: 2 }] },
    };
    const plan = planSplit([holding(), holding({ positionId: 2, playerId: 11 })], "ACME", 2, { date: exDate, log });
    expect(plan.positionPatches.map((patch) => patch.positionId)).toEqual([2]);
    expect(plan.summary).toMatch(/1 position\(s\) already reflected it/);
  });

  it("skips shares received in a deal after the ex-date", () => {
    const log = { ...emptyActionLog(), splitsAfterByPosition: { "1": exDate + DAY } };
    expect(() => planSplit([holding()], "ACME", 2, { date: exDate, log })).toThrow(AlreadyAppliedError);
  });
});

describe("fix 7: reverse splits beyond 1-for-20", () => {
  it("accepts 1-for-30 and 1-for-100 from Yahoo instead of silently dropping them", () => {
    expect(isCleanSplitRatio(1 / 30)).toBe(true);
    expect(isCleanSplitRatio(1 / 100)).toBe(true);
    expect(isCleanSplitRatio(2 / 3)).toBe(true);
    expect(isCleanSplitRatio(1.013)).toBe(false);
    const splits: YahooSplit[] = [{ id: "e", date: 1_800_000_000, numerator: 1, denominator: 30 }];
    expect(unappliedSplits(splits, 1_700_000_000, [])).toHaveLength(1);
    expect(implausibleSplits(splits, 1_700_000_000, [])).toEqual([]);
  });

  it("reports implausible Yahoo ratios rather than applying them", () => {
    const splits: YahooSplit[] = [{ id: "bad", date: 1_800_000_000, numerator: 1013, denominator: 1000 }];
    expect(unappliedSplits(splits, 1_700_000_000, [])).toEqual([]);
    expect(implausibleSplits(splits, 1_700_000_000, []).map((split) => split.id)).toEqual(["bad"]);
  });

  it("applies a 1-for-30 admin split and rejects nonsense loudly", () => {
    const patch = planSplit([holding({ quantity: 300, startPrice: 1 })], "ACME", 1 / 30).positionPatches[0];
    expect(patch.quantity).toBeCloseTo(10);
    expect(patch.startPrice).toBeCloseTo(30);
    for (const ratio of [0, -2, Number.NaN, Number.POSITIVE_INFINITY, 1, 5000, 1 / 5000]) {
      expect(() => assertSplitRatio(ratio)).toThrow();
    }
  });
});

describe("fix 10: the deal's effective date, not the recording time", () => {
  it("cuts acquirer split history at the effective date", () => {
    const effectiveAt = parseEffectiveDate("2026-07-27");
    const plan = planStockConversion([holding()], [listing()], {
      symbol: "ACME",
      acquirerSymbol: "BUYER",
      ratio: 0.5,
      effectiveAt,
      now,
    });
    expect(plan.positionPatches[0].splitsAfter).toBe(effectiveAt);
    expect(plan.positionPatches[0].effectiveAt).toBe(effectiveAt);
    expect(effectiveAt).toBeLessThan(now.getTime() / 1000);
  });

  it("dates a manual split at its ex-date", () => {
    const date = parseEffectiveDate("2026-07-20");
    const patch = planSplit([holding()], "ACME", 2, { date }).positionPatches[0];
    expect(patch.splitRecord?.date).toBe(date);
    expect(patch.effectiveAt).toBe(date);
    expect(() => parseEffectiveDate("next tuesday")).toThrow();
  });

  it("does not trust a share-less snapshot row taken before the action took effect", () => {
    const effectiveAt = parseEffectiveDate("2026-07-30");
    const rows = (capturedAt: string) => [{
      playerId: 10,
      capturedAt: new Date(capturedAt),
      breakdown: [{ assetId: 5, price: 100 }],
    }];
    const position = { playerId: 10, positionId: 1, assetIds: [5], quantity: 20, effectiveAt };
    expect(lastKnownPriceFor(rows("2026-07-29T18:00:00Z"), position)).toBeNull();
    expect(lastKnownPriceFor(rows("2026-07-31T18:00:00Z"), position)).toBe(100);
  });

  it("holds the intraday chart flat before the deal instead of replaying the successor's series", () => {
    const HOUR = 3_600_000;
    const rows = buildIntradayHistory(
      [{
        id: 1,
        positions: [{
          assetKey: "yahoo:BUYER",
          quantity: 5,
          allocation: 1000,
          isMvp: false,
          fallbackPrice: 240,
          effectiveAtMs: HOUR,
        }],
      }],
      new Map([["yahoo:BUYER", [300, 250, 260]]]),
      [0, HOUR, 2 * HOUR],
    );
    expect(rows.map((row) => row["1"])).toEqual([1200, 1250, 1300]);
  });

  it("uses each position's own fallback when the shared quote series is missing", () => {
    const rows = buildIntradayHistory(
      [
        { id: 1, positions: [{ assetKey: "yahoo:BUYER", quantity: 5, allocation: 1000, isMvp: false, fallbackPrice: 240 }] },
        { id: 2, positions: [{ assetKey: "yahoo:BUYER", quantity: 4, allocation: 1000, isMvp: false, fallbackPrice: 250 }] },
      ],
      new Map(),
      [0],
    );
    expect(rows[0]).toMatchObject({ "1": 1200, "2": 1000 });
  });
});

describe("fix 11: corrupted action log fails loudly", () => {
  it("throws on invalid JSON and malformed fields instead of returning an empty log", () => {
    expect(() => parseActionLog("{not json")).toThrow(CorruptActionLogError);
    expect(() => parseActionLog("[]")).toThrow(CorruptActionLogError);
    expect(() => parseActionLog(JSON.stringify({ appliedSplitsByPosition: { "1": [{ id: 3 }] } })))
      .toThrow(/appliedSplitsByPosition/);
    expect(() => parseActionLog(JSON.stringify({ revision: "7" }))).toThrow(/revision/);
  });

  it("still reads a log written before the new fields existed", () => {
    const log = parseActionLog(JSON.stringify({
      appliedSplitsByPosition: { "1": [{ id: "a", date: 1, ratio: 2 }] },
      splitsAfterByPosition: {},
      lineageByPosition: { "1": [5] },
    }));
    expect(log.revision).toBe(0);
    expect(log.appliedActionIds).toEqual([]);
    expect(log.lineageByPosition).toEqual({ "1": [5] });
  });
});

describe("fix 12: stock conversions cannot point at cash", () => {
  it("rejects CASH, the log row, and a listing that is already a cash buyout", () => {
    expect(() => planStockConversion([holding()], [listing()], { symbol: "ACME", acquirerSymbol: "cash", ratio: 1, now }))
      .toThrow(/cash buyout instead/);
    expect(() => planStockConversion(
      [holding()],
      [listing()],
      { symbol: "ACME", acquirerSymbol: "__CORP_ACTIONS__", ratio: 1, now },
    )).toThrow();
    expect(() => planStockConversion(
      [holding()],
      [listing(), listing({ id: 9, symbol: "GONE", type: "cash", priceSource: "none", sourceId: "" })],
      { symbol: "ACME", acquirerSymbol: "GONE", ratio: 1, now },
    )).toThrow(/cash listing/);
  });
});

describe("fix 13: only real evidence is labelled a possible corporate action", () => {
  const base = { lastSnapshotPrice: 80, startPrice: 50, priceSource: "yahoo" };

  it("shows a rate limit or timeout as a plain outage", () => {
    for (const error of ["yahoo ACME: HTTP 429", "The operation was aborted due to timeout", "coingecko x: HTTP 500"]) {
      const quote = resolvePositionQuote({ ...base, live: { error } });
      expect(quote.pricingStatus).toBe("unpriced");
      expect(quote.possibleCorporateAction).toBe(false);
    }
    expect(unpricedHint("ACME", [], undefined, false)).toMatch(/quote unavailable/i);
  });

  it("flags a delisting, a redirected symbol, or a merger-map entry", () => {
    const flagged = (live: { error: string; quotedSymbol?: string }, corporateActionSignal?: boolean) =>
      resolvePositionQuote({ ...base, live, corporateActionSignal }).possibleCorporateAction;
    expect(flagged({ error: "yahoo ACME: HTTP 404: No data found, symbol may be delisted" })).toBe(true);
    expect(flagged({ error: "yahoo ACME: quote returned for BUYER", quotedSymbol: "BUYER" })).toBe(true);
    expect(flagged({ error: "timeout" }, true)).toBe(true);
    expect(unpricedHint("ACME", [], "BUYER")).toMatch(/answered for BUYER/);
  });
});

describe("fix 6: quote caches are versioned by the action revision", () => {
  it("misses after the revision changes and after an explicit clear", () => {
    clearQuoteCaches();
    writeQuoteCache("standings:prices", 3, "cached");
    expect(readQuoteCache("standings:prices", 3, 60_000)?.value).toBe("cached");
    expect(readQuoteCache("standings:prices", 4, 60_000)).toBeNull();
    clearQuoteCaches();
    expect(readQuoteCache("standings:prices", 3, 60_000)).toBeNull();
  });
});
