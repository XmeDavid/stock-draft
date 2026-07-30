import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getPrice, getPrices, sourceKey } from "@/lib/prices";

const yahooResponse = (price: number) => ({
  ok: true,
  json: async () => ({
    chart: { result: [{ meta: { regularMarketPrice: price } }] },
  }),
});
const geckoResponse = (id: string, cur: string, price: number) => ({
  ok: true,
  json: async () => ({ [id]: { [cur.toLowerCase()]: price } }),
});

const mockFetch = vi.fn();
beforeEach(() => { vi.stubGlobal("fetch", mockFetch); mockFetch.mockReset(); });
afterEach(() => { vi.unstubAllGlobals(); });

const eurEtf = { priceSource: "yahoo", sourceId: "VWCE.DE", quoteCurrency: "EUR", type: "etf" };
const usdGold = { priceSource: "yahoo", sourceId: "GC=F", quoteCurrency: "USD", type: "gold" };
const btc = { priceSource: "coingecko", sourceId: "bitcoin", quoteCurrency: "EUR", type: "crypto" };
const cash = { priceSource: "none", sourceId: "", quoteCurrency: "EUR", type: "cash" };

describe("getPrice", () => {
  it("returns yahoo price directly when quote currency = race currency", async () => {
    mockFetch.mockResolvedValueOnce(yahooResponse(105.5));
    expect(await getPrice(eurEtf, "EUR")).toBe(105.5);
  });
  it("converts via FX when quote currency differs", async () => {
    // first call: GC=F price in USD; second call: EURUSD=X rate
    mockFetch
      .mockResolvedValueOnce(yahooResponse(2000))
      .mockResolvedValueOnce(yahooResponse(1.25)); // 1 EUR = 1.25 USD
    expect(await getPrice(usdGold, "EUR")).toBeCloseTo(1600);
    expect(mockFetch.mock.calls[1][0]).toContain("EURUSD=X");
  });
  it("asks coingecko in race currency directly", async () => {
    mockFetch.mockResolvedValueOnce(geckoResponse("bitcoin", "eur", 60000));
    expect(await getPrice(btc, "EUR")).toBe(60000);
    expect(String(mockFetch.mock.calls[0][0])).toContain("vs_currencies=eur");
  });
  it("returns 1 for cash without fetching", async () => {
    expect(await getPrice(cash, "EUR")).toBe(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    await expect(getPrice(eurEtf, "EUR")).rejects.toThrow();
  });
});

describe("getPrices", () => {
  it("collects successes and errors without throwing", async () => {
    mockFetch
      .mockResolvedValueOnce(yahooResponse(100))
      .mockRejectedValueOnce(new Error("network down"));
    const res = await getPrices([eurEtf, btc], "EUR");
    expect(res.get(sourceKey(eurEtf))).toEqual({ price: 100 });
    expect(res.get(sourceKey(btc))).toHaveProperty("error");
  });
});
