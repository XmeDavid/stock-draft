import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPrices, sourceKey } from "@/lib/prices";
import { resolvePositionQuote } from "@/lib/corporateActions";

const mockFetch = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const meta = (fields: Record<string, unknown>) => ({
  ok: true,
  json: async () => ({ chart: { result: [{ meta: fields }] } }),
});

describe("fix 8: Yahoo successor tickers are not live prices for the original", () => {
  it("turns a quote for a different symbol into a failure carrying that symbol", async () => {
    const target = { priceSource: "yahoo", sourceId: "TARGET", quoteCurrency: "USD", type: "equity" };
    mockFetch.mockResolvedValueOnce(meta({ regularMarketPrice: 200, symbol: "BUYER" }));

    const result = (await getPrices([target], "USD")).get(sourceKey(target));

    expect(result).toEqual({ error: "yahoo TARGET: quote returned for BUYER", quotedSymbol: "BUYER" });
    const quote = resolvePositionQuote({ live: result, lastSnapshotPrice: 100, startPrice: 90, priceSource: "yahoo" });
    expect(quote).toMatchObject({ price: 100, pricingStatus: "unpriced", possibleCorporateAction: true });
  });

  it("still accepts the same listing under different punctuation", async () => {
    const berkshire = { priceSource: "yahoo", sourceId: "BRK-B", quoteCurrency: "USD", type: "equity" };
    mockFetch.mockResolvedValueOnce(meta({ regularMarketPrice: 450, symbol: "BRK.B" }));
    expect((await getPrices([berkshire], "USD")).get(sourceKey(berkshire))).toMatchObject({ price: 450 });
  });
});
