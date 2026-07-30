export type PriceAsset = {
  priceSource: string;
  sourceId: string;
  quoteCurrency: string;
  type: string;
};
export type PriceResult = { price: number } | { error: string };

const UA = { headers: { "User-Agent": "Mozilla/5.0 (race-to-1-mil)" } };

export function sourceKey(a: PriceAsset): string {
  return `${a.priceSource}:${a.sourceId}`;
}

async function yahooQuote(ticker: string): Promise<number> {
  // Tickers contain "=" ("GC=F", "EURUSD=X"), which is legal in a URL path
  // segment — keep it literal while escaping anything else unsafe.
  const path = encodeURIComponent(ticker).replace(/%3D/g, "=");
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${path}?interval=1d&range=1d`;
  const res = await fetch(url, UA);
  if (!res.ok) throw new Error(`yahoo ${ticker}: HTTP ${res.status}`);
  const data = await res.json();
  const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
  if (typeof price !== "number") throw new Error(`yahoo ${ticker}: no price in response`);
  return price;
}

async function fxRate(from: string, to: string): Promise<number> {
  if (from === to) return 1;
  // Yahoo FX ticker "EURUSD=X" = how many USD per 1 EUR.
  return yahooQuote(`${to}${from}=X`).then((r) => 1 / r);
}

async function coingeckoQuote(id: string, currency: string): Promise<number> {
  const cur = currency.toLowerCase();
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=${cur}`;
  const res = await fetch(url, UA);
  if (!res.ok) throw new Error(`coingecko ${id}: HTTP ${res.status}`);
  const data = await res.json();
  const price = data?.[id]?.[cur];
  if (typeof price !== "number") throw new Error(`coingecko ${id}: no price`);
  return price;
}

export async function getPrice(asset: PriceAsset, raceCurrency: string): Promise<number> {
  if (asset.priceSource === "none") return 1; // cash: 1 unit = 1 currency unit
  if (asset.priceSource === "coingecko") {
    return coingeckoQuote(asset.sourceId, raceCurrency);
  }
  const raw = await yahooQuote(asset.sourceId);
  const rate = await fxRate(asset.quoteCurrency, raceCurrency);
  return raw * rate;
}

export async function getPrices(
  assets: PriceAsset[],
  raceCurrency: string
): Promise<Map<string, PriceResult>> {
  const out = new Map<string, PriceResult>();
  for (const a of assets) {
    if (out.has(sourceKey(a))) continue;
    try {
      out.set(sourceKey(a), { price: await getPrice(a, raceCurrency) });
    } catch (e) {
      out.set(sourceKey(a), { error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}
