import { getPlayersWithPositions, getSnapshotsWithPlayers } from "@/lib/data";
import { readActionLogOrReport } from "@/lib/applyCorporateActions";
import { historicalAssetIds, lastKnownPriceFor, type SnapshotHistory } from "@/lib/corporateActions";
import { readQuoteCache, writeQuoteCache } from "@/lib/quoteCache";
import { mvpRevealed } from "@/lib/mvpReveal";
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
  positions: {
    assetKey: string;
    quantity: number;
    allocation: number;
    isMvp: boolean;
    /** This position's own last known price in current share units. Used when the quote series is missing. */
    fallbackPrice?: number;
    /** Unix ms the latest corporate action took effect. Earlier points hold `fallbackPrice`. */
    effectiveAtMs?: number;
  }[];
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
        // Before a deal took effect the successor's series is not this position's history.
        const beforeAction = position.effectiveAtMs !== undefined && t < position.effectiveAtMs;
        const price = prices && !(beforeAction && position.fallbackPrice !== undefined)
          ? prices[index]
          : position.fallbackPrice;
        if (price === undefined) return sum;
        return sum + positionValue(position.quantity, price, position.allocation, position.isMvp);
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

export async function getIntradayHistory(range: IntradayRange): Promise<IntradayResult> {
  // Versioned by the corporate-action revision so a split or deal never meets a cached chart.
  const log = await readActionLogOrReport("intraday");
  const revision = log?.revision ?? -1;
  const cacheKey = `intraday:${range}`;
  const hit = readQuoteCache<IntradayResult>(cacheKey, revision, CACHE_TTL_MS);
  if (hit) return hit.value;

  const race = await getRace();
  if (race.status !== "running") {
    const err = new Error(`Intraday history is only available while the race is running (status: ${race.status})`);
    (err as Error & { status?: number }).status = 409;
    throw err;
  }
  const playerRows = await getPlayersWithPositions();
  const snapshotRows = await getSnapshotsWithPlayers().catch(() => []);
  const history: SnapshotHistory[] = snapshotRows.map((row) => ({
    playerId: row.snapshot.playerId,
    capturedAt: row.snapshot.capturedAt,
    breakdown: (row.snapshot.breakdown ?? []) as SnapshotHistory["breakdown"],
  }));
  const grid = buildGrid(Date.now(), range);

  // One fetch per unique asset plus one per foreign quote currency (FX pair).
  // Fallbacks are per position: a converted pick's restated price must not
  // leak onto another player's acquirer shares that share the quote key.
  const assetByKey = new Map<string, PriceAsset>();
  for (const player of playerRows) {
    for (const position of player.positions) {
      const key = sourceKey(position.asset as PriceAsset);
      if (!assetByKey.has(key)) assetByKey.set(key, position.asset as PriceAsset);
    }
  }
  const fxCurrencies = [...new Set(
    [...assetByKey.values()]
      .filter((asset) => asset.priceSource !== "none" && asset.priceSource !== "coingecko")
      .map((asset) => asset.quoteCurrency)
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
  await Promise.all([...assetByKey].map(async ([key, asset]) => {
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
      // No series: each position holds flat at its own last known race-currency price
      // rather than dropping out. `degraded` tells the chart this is not a live print.
      degraded = true;
    }
  }));

  // Public chart: before the MVP reveal, totals are at market so the leverage cannot expose a pick.
  const revealed = mvpRevealed(playerRows.length, playerRows.flatMap((player) => player.positions));
  const players: IntradayPlayer[] = playerRows.map((player) => ({
    id: player.id,
    positions: player.positions.map((position) => {
      const key = String(position.id);
      const quantity = position.quantity ?? 0;
      const known = lastKnownPriceFor(history, {
        playerId: player.id,
        positionId: position.id,
        assetIds: historicalAssetIds(position.assetId, log?.lineageByPosition[key]),
        quantity,
        effectiveAt: log?.effectiveAtByPosition[key],
      });
      const effectiveAt = log?.effectiveAtByPosition[key];
      return {
        assetKey: sourceKey(position.asset as PriceAsset),
        quantity,
        allocation: position.allocation,
        isMvp: revealed && position.isMvp,
        fallbackPrice: position.asset.priceSource === "none" ? 1 : known ?? position.startPrice ?? 0,
        ...(effectiveAt === undefined ? {} : { effectiveAtMs: effectiveAt * 1000 }),
      };
    }),
  }));

  const result: IntradayResult = {
    range,
    generatedAt: new Date().toISOString(),
    degraded,
    history: buildIntradayHistory(players, pricesByAsset, grid),
  };
  // The reveal is not part of the cache key, so only cache once it has happened.
  if (revealed) writeQuoteCache(cacheKey, revision, result);
  return result;
}
