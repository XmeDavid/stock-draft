import { getPlayersWithPositions } from "@/lib/data";
import { fetchOptions, sourceKey, type PriceAsset } from "@/lib/prices";
import { getRace } from "@/lib/race";
import { positionValue } from "@/lib/valuation";

export type IntradayRange = "1d" | "1w";
export type SeriesPoint = { t: number; price: number };

const RANGES: Record<IntradayRange, { spanMs: number; stepMs: number }> = {
  "1d": { spanMs: 24 * 3_600_000, stepMs: 15 * 60_000 },
  "1w": { spanMs: 7 * 24 * 3_600_000, stepMs: 3_600_000 },
};

export function buildGrid(nowMs: number, range: IntradayRange): number[] {
  const { spanMs, stepMs } = RANGES[range];
  const end = Math.floor(nowMs / stepMs) * stepMs;
  const grid: number[] = [];
  for (let t = end - spanMs; t <= end; t += stepMs) grid.push(t);
  return grid;
}

/** Forward-fill the latest price onto each grid point; backfill from the first point before the series starts. */
export function resampleOnGrid(points: SeriesPoint[], grid: number[]): number[] {
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const first = sorted[0]?.price ?? 0;
  let index = 0;
  let latest: number | undefined;
  return grid.map((t) => {
    while (index < sorted.length && sorted[index].t <= t) latest = sorted[index++].price;
    return latest ?? first;
  });
}

export type IntradayPlayer = {
  id: number;
  positions: { assetKey: string; quantity: number; allocation: number; isMvp: boolean }[];
};

export function buildIntradayHistory(
  players: IntradayPlayer[],
  pricesByAsset: Map<string, number[]>,
  grid: number[]
): Record<string, number | string>[] {
  return grid.map((t, index) => {
    const row: Record<string, number | string> = { date: new Date(t).toISOString() };
    for (const player of players) {
      row[String(player.id)] = player.positions.reduce((sum, position) => {
        const prices = pricesByAsset.get(position.assetKey);
        if (!prices) return sum;
        return sum + positionValue(position.quantity, prices[index], position.allocation, position.isMvp);
      }, 0);
    }
    return row;
  });
}

async function yahooIntradaySeries(ticker: string, range: IntradayRange): Promise<SeriesPoint[]> {
  const path = encodeURIComponent(ticker).replace(/%3D/g, "=");
  const params = range === "1d" ? "interval=5m&range=1d" : "interval=30m&range=5d";
  const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${path}?${params}`, fetchOptions());
  if (!res.ok) throw new Error(`yahoo ${ticker}: HTTP ${res.status}`);
  const data = await res.json() as {
    chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<{ close?: (number | null)[] }> } }> };
  };
  const result = data.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const points = timestamps.flatMap((t, i) =>
    typeof closes[i] === "number" ? [{ t: t * 1000, price: closes[i] }] : []
  );
  if (points.length === 0) throw new Error(`yahoo ${ticker}: empty intraday series`);
  return points;
}

async function coingeckoIntradaySeries(id: string, currency: string, range: IntradayRange): Promise<SeriesPoint[]> {
  const days = range === "1d" ? 1 : 7;
  const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/market_chart`
    + `?vs_currency=${encodeURIComponent(currency.toLowerCase())}&days=${days}`;
  const res = await fetch(url, fetchOptions());
  if (!res.ok) throw new Error(`coingecko ${id}: HTTP ${res.status}`);
  const data = await res.json() as { prices?: [number, number][] };
  const points = (data.prices ?? []).map(([t, price]) => ({ t, price }));
  if (points.length === 0) throw new Error(`coingecko ${id}: empty intraday series`);
  return points;
}

export type IntradayResult = {
  range: IntradayRange;
  generatedAt: string;
  degraded: boolean;
  history: Record<string, number | string>[];
};

const CACHE_TTL_MS = 5 * 60_000;
const cacheGlobal = globalThis as typeof globalThis & {
  intradayCache?: Map<IntradayRange, { at: number; result: IntradayResult }>;
};

export async function getIntradayHistory(range: IntradayRange): Promise<IntradayResult> {
  const cache = cacheGlobal.intradayCache ??= new Map();
  const hit = cache.get(range);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.result;

  const race = await getRace();
  if (race.status !== "running") {
    const err = new Error(`Intraday history is only available while the race is running (status: ${race.status})`);
    (err as Error & { status?: number }).status = 409;
    throw err;
  }
  const playerRows = await getPlayersWithPositions();
  const grid = buildGrid(Date.now(), range);

  // One fetch per unique asset plus one per foreign quote currency (FX pair).
  const assetByKey = new Map<string, { asset: PriceAsset; fallbackPrice: number }>();
  for (const player of playerRows) {
    for (const position of player.positions) {
      const key = sourceKey(position.asset as PriceAsset);
      if (!assetByKey.has(key)) {
        assetByKey.set(key, { asset: position.asset as PriceAsset, fallbackPrice: position.startPrice ?? 0 });
      }
    }
  }
  const fxCurrencies = [...new Set(
    [...assetByKey.values()]
      .filter(({ asset }) => asset.priceSource !== "none" && asset.priceSource !== "coingecko")
      .map(({ asset }) => asset.quoteCurrency)
      .filter((currency) => currency !== race.currency)
  )];

  let degraded = false;
  const fxOnGrid = new Map<string, number[]>();
  await Promise.all(fxCurrencies.map(async (currency) => {
    try {
      // "EURUSD=X" quotes USD per EUR, so dividing converts USD prices into EUR.
      const series = await yahooIntradaySeries(`${race.currency}${currency}=X`, range);
      fxOnGrid.set(currency, resampleOnGrid(series, grid));
    } catch {
      degraded = true;
    }
  }));

  const pricesByAsset = new Map<string, number[]>();
  await Promise.all([...assetByKey].map(async ([key, { asset, fallbackPrice }]) => {
    try {
      if (asset.priceSource === "none") {
        pricesByAsset.set(key, grid.map(() => 1));
        return;
      }
      if (asset.priceSource === "coingecko") {
        const series = await coingeckoIntradaySeries(asset.sourceId, race.currency, range);
        pricesByAsset.set(key, resampleOnGrid(series, grid));
        return;
      }
      const raw = resampleOnGrid(await yahooIntradaySeries(asset.sourceId, range), grid);
      if (asset.quoteCurrency === race.currency) {
        pricesByAsset.set(key, raw);
        return;
      }
      const fx = fxOnGrid.get(asset.quoteCurrency);
      if (!fx) throw new Error(`no FX series for ${asset.quoteCurrency}`);
      pricesByAsset.set(key, raw.map((price, index) => price / fx[index]));
    } catch {
      // Hold the asset flat at its race-currency start price rather than dropping it.
      degraded = true;
      pricesByAsset.set(key, grid.map(() => fallbackPrice));
    }
  }));

  const players: IntradayPlayer[] = playerRows.map((player) => ({
    id: player.id,
    positions: player.positions.map((position) => ({
      assetKey: sourceKey(position.asset as PriceAsset),
      quantity: position.quantity ?? 0,
      allocation: position.allocation,
      isMvp: position.isMvp,
    })),
  }));

  const result: IntradayResult = {
    range,
    generatedAt: new Date().toISOString(),
    degraded,
    history: buildIntradayHistory(players, pricesByAsset, grid),
  };
  cache.set(range, { at: Date.now(), result });
  return result;
}
