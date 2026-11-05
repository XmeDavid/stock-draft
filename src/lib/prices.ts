import { splitsFromChart, tickerKey, type YahooSplit } from "@/lib/corporateActions";
import { issuerKey } from "@/lib/issuer";

export type PriceAsset = {
  priceSource: string;
  sourceId: string;
  quoteCurrency: string;
  type: string;
};
export type PriceSuccess = {
  price: number;
  previousClose?: number;
  /** Set when Yahoo's meta names the instrument. Compared with the drafted ticker. */
  quotedSymbol?: string;
  /** Splits embedded in the quote response (usually only those inside the requested range). */
  splits?: YahooSplit[];
};
/** `quotedSymbol` is set when Yahoo answered for a different instrument than requested. */
export type PriceResult = PriceSuccess | { error: string; quotedSymbol?: string };

/** Yahoo redirected the ticker to another instrument (often the acquirer). Not a price for the original. */
export class QuotedSymbolMismatchError extends Error {
  constructor(readonly requested: string, readonly quotedSymbol: string) {
    super(`yahoo ${requested}: quote returned for ${quotedSymbol}`);
  }
}

// Built per request: the abort timer starts the moment the signal is created.
const requestHeaders = { "User-Agent": "Mozilla/5.0 (race-to-1-mil)" };

export const fetchOptions = (): RequestInit => ({
  headers: requestHeaders,
  signal: AbortSignal.timeout(8000),
});

export function sourceKey(a: PriceAsset): string {
  return `${a.priceSource}:${a.sourceId}`;
}

type YahooChartResult = {
  meta?: Record<string, unknown>;
  events?: { splits?: Record<string, unknown> };
};

function yahooChartPath(ticker: string): string {
  // Tickers contain "=" ("GC=F", "EURUSD=X"), which is legal in a URL path
  // segment — keep it literal while escaping anything else unsafe.
  return encodeURIComponent(ticker).replace(/%3D/g, "=");
}

async function readYahooError(res: Response): Promise<string> {
  if (typeof res.json !== "function") return "";
  const body = await res.json().catch(() => null) as { chart?: { error?: { description?: unknown } } } | null;
  const description = body?.chart?.error?.description;
  return typeof description === "string" && description ? `: ${description}` : "";
}

async function yahooChart(ticker: string, query: string): Promise<YahooChartResult> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooChartPath(ticker)}?${query}`;
  const res = await fetch(url, fetchOptions());
  if (!res.ok) throw new Error(`yahoo ${ticker}: HTTP ${res.status}${await readYahooError(res)}`);
  const data = await res.json() as { chart?: { result?: YahooChartResult[] } };
  return data?.chart?.result?.[0] ?? {};
}

async function yahooChartMeta(ticker: string): Promise<Record<string, unknown>> {
  const result = await yahooChart(ticker, "interval=1d&range=1d&events=split");
  return result.meta ?? {};
}

/** Split history since the race can outlive a 1-day quote window. Used by the daily sync. */
export async function fetchYahooSplitEvents(ticker: string): Promise<YahooSplit[]> {
  const result = await yahooChart(ticker, "interval=1d&range=5y&events=split");
  return splitsFromChart({ chart: { result: [result] } });
}

async function yahooQuote(ticker: string): Promise<number> {
  const meta = await yahooChartMeta(ticker);
  const price = meta.regularMarketPrice;
  if (typeof price !== "number") throw new Error(`yahoo ${ticker}: no price in response`);
  return price;
}

async function yahooPricePoint(ticker: string): Promise<PriceSuccess> {
  const result = await yahooChart(ticker, "interval=1d&range=1d&events=split");
  const meta = result.meta ?? {};
  const price = meta.regularMarketPrice;
  if (typeof price !== "number") throw new Error(`yahoo ${ticker}: no price in response`);
  const previous = typeof meta.chartPreviousClose === "number"
    ? meta.chartPreviousClose
    : typeof meta.previousClose === "number"
      ? meta.previousClose
      : undefined;
  const quotedSymbol = typeof meta.symbol === "string" && meta.symbol.trim()
    ? meta.symbol.trim().toUpperCase()
    : undefined;
  // BRK.B vs BRK-B is the same listing; anything else is a successor, not this ticker's price.
  if (quotedSymbol && tickerKey(quotedSymbol) !== tickerKey(ticker)) {
    throw new QuotedSymbolMismatchError(ticker, quotedSymbol);
  }
  const splits = splitsFromChart({ chart: { result: [result] } });
  return {
    price,
    ...(previous === undefined ? {} : { previousClose: previous }),
    ...(quotedSymbol ? { quotedSymbol } : {}),
    ...(splits.length > 0 ? { splits } : {}),
  };
}

export type ResolvedTicker = {
  symbol: string;
  price: number;
  currency: string;
  name: string;
  type: string;
  exchange: string;
};

export type TickerSearchResult = {
  symbol: string;
  name: string;
  type: string;
  exchange: string;
  alternatives: TickerListing[];
};

export type TickerListing = Omit<TickerSearchResult, "alternatives">;

function mapInstrumentType(instrumentType: unknown): string {
  switch (String(instrumentType ?? "").toUpperCase()) {
    case "CRYPTOCURRENCY":
      return "crypto";
    case "ETF":
      return "etf";
    case "FUTURE":
      return "gold";
    case "EQUITY":
      return "equity";
    default:
      return String(instrumentType ?? "asset").toLowerCase();
  }
}

export function groupTickerListings(listings: TickerListing[], query: string): TickerSearchResult[] {
  const exactSymbol = query.trim().toUpperCase();
  const groups = new Map<string, TickerListing[]>();

  for (const listing of listings) {
    const key = issuerKey(listing);
    const group = groups.get(key);
    if (group) group.push(listing);
    else groups.set(key, [listing]);
  }

  return [...groups.values()].map((group) => {
    const preferredIndex = group.findIndex((listing) => listing.symbol === exactSymbol);
    const primaryIndex = preferredIndex >= 0 ? preferredIndex : 0;
    const primary = group[primaryIndex];
    return {
      ...primary,
      alternatives: group.filter((_, index) => index !== primaryIndex),
    };
  });
}

export async function resolveTicker(ticker: string): Promise<ResolvedTicker> {
  const symbol = ticker.trim().toUpperCase();
  const meta = await yahooChartMeta(symbol);
  const price = meta.regularMarketPrice;
  if (typeof price !== "number") throw new Error(`yahoo ${symbol}: no price in response`);
  const currency = meta.currency;
  if (typeof currency !== "string" || !currency) {
    throw new Error(`yahoo ${symbol}: no currency in response`);
  }
  const name = (typeof meta.longName === "string" && meta.longName)
    || (typeof meta.shortName === "string" && meta.shortName)
    || symbol;
  const exchange = (typeof meta.fullExchangeName === "string" && meta.fullExchangeName)
    || (typeof meta.exchangeName === "string" && meta.exchangeName)
    || "";
  return { symbol, price, currency, name, type: mapInstrumentType(meta.instrumentType), exchange };
}

export async function searchTickers(query: string): Promise<TickerSearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const url = new URL("https://query1.finance.yahoo.com/v1/finance/search");
  url.searchParams.set("q", q);
  url.searchParams.set("quotesCount", "8");
  url.searchParams.set("newsCount", "0");
  url.searchParams.set("enableFuzzyQuery", "false");

  const res = await fetch(url, { headers: requestHeaders, signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new Error(`Yahoo search: HTTP ${res.status}`);
  const data = await res.json() as { quotes?: Record<string, unknown>[] };
  const quotes = Array.isArray(data?.quotes) ? data.quotes : [];
  const listings = quotes.flatMap((quote: Record<string, unknown>) => {
    const symbol = typeof quote.symbol === "string" ? quote.symbol.trim().toUpperCase() : "";
    if (!symbol) return [];
    const name = (typeof quote.longname === "string" && quote.longname)
      || (typeof quote.shortname === "string" && quote.shortname)
      || symbol;
    const exchange = (typeof quote.exchDisp === "string" && quote.exchDisp)
      || (typeof quote.exchange === "string" && quote.exchange)
      || "";
    return [{
      symbol,
      name,
      type: mapInstrumentType(quote.quoteType),
      exchange,
    }];
  });
  return groupTickerListings(listings, q);
}

async function fxRate(from: string, to: string): Promise<number> {
  if (from === to) return 1;
  // Yahoo FX ticker "EURUSD=X" = how many USD per 1 EUR.
  return yahooQuote(`${to}${from}=X`).then((r) => 1 / r);
}

async function coingeckoQuote(id: string, currency: string): Promise<number> {
  const cur = currency.toLowerCase();
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=${cur}`;
  const res = await fetch(url, fetchOptions());
  if (!res.ok) throw new Error(`coingecko ${id}: HTTP ${res.status}`);
  const data = await res.json() as Record<string, Record<string, number> | undefined>;
  const price = data?.[id]?.[cur];
  if (typeof price !== "number") throw new Error(`coingecko ${id}: no price`);
  return price;
}

export async function getPrice(asset: PriceAsset, raceCurrency: string): Promise<number> {
  return (await getPricePoint(asset, raceCurrency)).price;
}

async function getPricePoint(
  asset: PriceAsset,
  raceCurrency: string
): Promise<{ price: number; previousClose?: number }> {
  if (asset.priceSource === "none") return { price: 1, previousClose: 1 }; // cash: 1 unit = 1 currency unit
  if (asset.priceSource === "coingecko") {
    return { price: await coingeckoQuote(asset.sourceId, raceCurrency) };
  }
  const raw = await yahooPricePoint(asset.sourceId);
  const rate = await fxRate(asset.quoteCurrency, raceCurrency);
  return {
    price: raw.price * rate,
    ...(raw.previousClose === undefined ? {} : { previousClose: raw.previousClose * rate }),
    ...(raw.quotedSymbol ? { quotedSymbol: raw.quotedSymbol } : {}),
    ...(raw.splits ? { splits: raw.splits } : {}),
  };
}

export async function getPrices(
  assets: PriceAsset[],
  raceCurrency: string
): Promise<Map<string, PriceResult>> {
  const out = new Map<string, PriceResult>();
  for (const a of assets) {
    if (out.has(sourceKey(a))) continue;
    try {
      out.set(sourceKey(a), await getPricePoint(a, raceCurrency));
    } catch (e) {
      out.set(sourceKey(a), {
        error: e instanceof Error ? e.message : String(e),
        ...(e instanceof QuotedSymbolMismatchError ? { quotedSymbol: e.quotedSymbol } : {}),
      });
    }
  }
  return out;
}
