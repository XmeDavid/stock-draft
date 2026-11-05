import { NextResponse } from "next/server";
import { getPlayersWithPositions, getSnapshotsWithPlayers } from "@/lib/data";
import { getRace } from "@/lib/race";
import { advanceRaceClock } from "@/lib/raceClock";
import { getPrices, sourceKey, type PriceAsset, type PriceResult } from "@/lib/prices";
import { percentGain } from "@/lib/valuation";
import { logoUrlForSymbol } from "@/lib/logos";
import {
  findBreakdownRow,
  historicalAssetIds,
  lastKnownPriceFor,
  resolvePositionQuote,
  tickerKey,
  unpricedHint,
  valuePosition,
  type PriceBasis,
} from "@/lib/corporateActions";
import { mergerMappings } from "@/lib/mergerMap";
import {
  applyConfiguredMappings,
  applySplitsFromQuotes,
  readLineageByPosition,
  recoverPunctuation,
} from "@/lib/applyCorporateActions";
import { withPortfolioBaseline, withReturnBaseline } from "@/lib/profileHistory";
import {
  buildWeeklyMatchups,
  daysLed,
  personalityFor,
  ranksForValues,
  type SnapshotPoint,
} from "@/lib/gamification";

export const dynamic = "force-dynamic";

let cache: { at: number; prices: Map<string, PriceResult> } | null = null;

type BreakdownRow = {
  assetId: number;
  price: number;
  value: number;
  allocation?: number;
  isMvp?: boolean;
  possibleCorporateAction?: boolean;
};

function failedYahooAssets(
  players: { positions: { asset: PriceAsset & { symbol: string } }[] }[],
  prices: Map<string, PriceResult>,
): { symbol: string; sourceId: string }[] {
  const failed: { symbol: string; sourceId: string }[] = [];
  const seen = new Set<string>();
  for (const player of players) {
    for (const position of player.positions) {
      if (position.asset.priceSource !== "yahoo" || seen.has(position.asset.symbol)) continue;
      const live = prices.get(sourceKey(position.asset));
      if (live && "price" in live) continue;
      seen.add(position.asset.symbol);
      failed.push({ symbol: position.asset.symbol, sourceId: position.asset.sourceId });
    }
  }
  return failed;
}
type Award = { title: string; player: string; detail: string };

function formatPct(value: number): string {
  const clean = Math.abs(value) < 0.005 ? 0 : value;
  return `${clean >= 0 ? "+" : ""}${clean.toFixed(2)}%`;
}

function standardDeviation(values: number[]): number {
  if (values.length === 0) return Number.POSITIVE_INFINITY;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

export async function GET(req: Request) {
  await advanceRaceClock();
  const race = await getRace();
  if (race.status === "running") {
    try {
      await applyConfiguredMappings();
    } catch (error) {
      console.error("corporate action mappings failed", error);
    }
  }
  const [loadedPlayers, snapshotRows] = await Promise.all([
    getPlayersWithPositions(),
    getSnapshotsWithPlayers(),
  ]);
  let players = loadedPlayers;
  const lineage = await readLineageByPosition().catch(() => new Map<number, number[]>());
  const snapshots = snapshotRows.map(({ snapshot, player }) => ({ ...snapshot, player }));

  let prices = new Map<string, PriceResult>();
  let pricesAsOf: Date | null = null;
  if (race.status === "running") {
    const forceRefresh = new URL(req.url).searchParams.get("refresh") === "1";
    const cacheHit = !forceRefresh && cache && Date.now() - cache.at < 5 * 60_000;
    if (cacheHit && cache) {
      prices = cache.prices;
    } else {
      const assets = players.flatMap((player) => player.positions.map((position) => position.asset as PriceAsset));
      prices = await getPrices(assets, race.currency);
      cache = { at: Date.now(), prices };
      // Only the request that talked to Yahoo may write a split or a punctuation rename.
      // Cached reads must not open a transaction or probe delisted tickers on every view.
      try {
        if (await applySplitsFromQuotes(prices)) {
          players = await getPlayersWithPositions();
        }
        if (await recoverPunctuation(failedYahooAssets(players, prices))) {
          players = await getPlayersWithPositions();
          const refreshed = players.flatMap((player) => player.positions.map((position) => position.asset as PriceAsset));
          prices = await getPrices(refreshed, race.currency);
          cache = { at: Date.now(), prices };
          if (await applySplitsFromQuotes(prices)) players = await getPlayersWithPositions();
        }
      } catch (error) {
        console.error("corporate action quote reconcile failed", error);
      }
    }
    pricesAsOf = cache ? new Date(cache.at) : null;
  }

  const latestSnapshotByPlayer = new Map<number, (typeof snapshots)[number]>();
  for (const snapshot of snapshots) latestSnapshotByPlayer.set(snapshot.playerId, snapshot);
  const capital = Number(race.startingCapital);

  const unsortedRows = players.map((player) => {
    const latestSnapshot = latestSnapshotByPlayer.get(player.id);
    let stale = race.status === "finished" && Boolean(latestSnapshot?.stale);
    const finalBreakdown = (latestSnapshot?.breakdown ?? []) as unknown as BreakdownRow[];
    const orderedPositions = [...player.positions].sort(
      (a, b) => (a.pickIndex ?? Number.MAX_SAFE_INTEGER) - (b.pickIndex ?? Number.MAX_SAFE_INTEGER)
    );
    const positions = orderedPositions.map((position) => {
        const assetIds = historicalAssetIds(position.assetId, lineage.get(position.id));
        const live = prices.get(sourceKey(position.asset as PriceAsset));
        const final = findBreakdownRow(finalBreakdown, assetIds);
        const startPrice = Number(position.startPrice ?? 0);
        let currentPrice = startPrice;
        let pricingStatus: "live" | "unpriced" = "live";
        let possibleCorporateAction = false;
        let priceBasis: PriceBasis = "start";
        let previousClose: number | undefined;
        let hint: string | null = null;
        if (race.status === "running") {
          const quote = resolvePositionQuote({
            live,
            lastSnapshotPrice: lastKnownPriceFor(
              snapshots.map((snapshot) => ({
                playerId: snapshot.playerId,
                breakdown: (snapshot.breakdown ?? []) as { assetId: number; price: number }[],
              })),
              player.id,
              assetIds,
            ),
            startPrice,
            priceSource: position.asset.priceSource,
          });
          currentPrice = quote.price;
          pricingStatus = quote.pricingStatus;
          possibleCorporateAction = quote.possibleCorporateAction;
          priceBasis = quote.priceBasis;
          previousClose = quote.previousClose;
          if (possibleCorporateAction) stale = true;
          const quotedSymbol = live && "quotedSymbol" in live ? live.quotedSymbol : undefined;
          hint = possibleCorporateAction
            ? unpricedHint(position.asset.symbol, mergerMappings, quotedSymbol)
            : quotedSymbol && tickerKey(quotedSymbol) !== tickerKey(position.asset.symbol)
              ? `Yahoo identifies this quote as ${quotedSymbol}.`
              : null;
        } else if (race.status === "finished" && final) {
          currentPrice = final.price;
          possibleCorporateAction = Boolean(final.possibleCorporateAction);
          pricingStatus = possibleCorporateAction ? "unpriced" : "live";
          priceBasis = possibleCorporateAction ? "last-snapshot" : "live";
          if (possibleCorporateAction) {
            stale = true;
            hint = unpricedHint(position.asset.symbol, mergerMappings);
          }
        }

        const quantity = Number(position.quantity ?? 0);
        const allocation = Number(position.allocation);
        const valued = valuePosition(
          { quantity, allocation, isMvp: position.isMvp, startPrice, type: position.asset.type },
          { price: currentPrice, previousClose, pricingStatus, possibleCorporateAction, priceBasis },
        );
        return {
          positionId: position.id,
          assetId: position.assetId,
          symbol: position.asset.symbol,
          name: position.asset.name,
          type: position.asset.type,
          logoUrl: logoUrlForSymbol(position.asset.symbol),
          quantity,
          allocation,
          startPrice,
          currentPrice,
          value: valued.value,
          todayGainPct: valued.todayGainPct,
          marketGainPct: valued.marketGainPct,
          gainPct: valued.gainPct,
          isMvp: position.isMvp,
          pricingStatus,
          possibleCorporateAction,
          priceBasis,
          hint,
        };
    });
    const currentValue = positions.reduce((sum, position) => sum + position.value, 0);
    return {
      id: player.id,
      name: player.name,
      strategy: player.strategy,
      color: player.color,
      currentValue,
      gainPct: capital > 0 ? percentGain(currentValue, capital) : 0,
      stale,
      positions,
    };
  });

  const playerRows = unsortedRows.sort((a, b) => b.currentValue - a.currentValue);
  const currentRanks = new Map(playerRows.map((player, index) => [player.id, index + 1]));
  const points: SnapshotPoint[] = snapshots.map((snapshot) => ({
    playerId: snapshot.playerId,
    date: snapshot.date,
    totalValue: Number(snapshot.totalValue),
  }));
  const leaderDays = daysLed(points);

  const today = new Date().toISOString().slice(0, 10);
  const historicalDates = [...new Set(snapshots.map((snapshot) => snapshot.date.toISOString().slice(0, 10)))];
  const finalSnapshotDate = historicalDates.at(-1);
  const priorDate = race.status === "finished" && finalSnapshotDate
    ? historicalDates.filter((date) => date < finalSnapshotDate).at(-1)
    : historicalDates.filter((date) => date < today).at(-1) ?? finalSnapshotDate;
  const priorRanks = priorDate
    ? ranksForValues(snapshots
        .filter((snapshot) => snapshot.date.toISOString().slice(0, 10) === priorDate)
        .map((snapshot) => ({ playerId: snapshot.playerId, value: Number(snapshot.totalValue) })))
    : new Map<number, number>();

  const enrichedPlayers = playerRows.map((player) => {
    const rank = currentRanks.get(player.id)!;
    const priorRank = priorRanks.get(player.id) ?? rank;
    const rankMovement = priorRank - rank;
    const draftedPicks = player.positions.filter((position) => position.type !== "cash");
    const sortedPicks = [...draftedPicks].sort((a, b) => b.gainPct - a.gainPct);
    const achievements: string[] = [];
    if (rank === 1) achievements.push("Current Leader");
    if (player.gainPct >= 10) achievements.push("10% Club");
    if (player.positions.length > 0 && player.positions.every((position) => position.gainPct >= 0)) achievements.push("Green Screen");
    if (player.positions.some((position) => position.marketGainPct >= 100)) achievements.push("Moonshot");
    if ((leaderDays.get(player.id) ?? 0) >= 10) achievements.push("Front Runner");
    if (rankMovement >= 2) achievements.push("Big Climber");
    if (player.positions.some((position) => position.isMvp && position.gainPct >= 25)) achievements.push("Captain's Call");
    let profileHistory = snapshots
      .filter((snapshot) => snapshot.playerId === player.id)
      .map((snapshot) => {
        const row: Record<string, number | string> = {
          date: snapshot.date.toISOString().slice(0, 10),
          Total: capital > 0 ? percentGain(Number(snapshot.totalValue), capital) : 0,
        };
        const breakdown = snapshot.breakdown as unknown as BreakdownRow[];
        for (const position of player.positions) {
          const point = findBreakdownRow(
            breakdown,
            historicalAssetIds(position.assetId, lineage.get(position.positionId)),
          );
          row[position.symbol] = point && position.allocation > 0
            ? percentGain(point.value, position.allocation)
            : 0;
        }
        return row;
      });
    profileHistory = withReturnBaseline(
      profileHistory,
      ["Total", ...player.positions.map((position) => position.symbol)]
    );
    if (race.status === "running") {
      const live: Record<string, number | string> = {
        date: "Live",
        Total: player.gainPct,
      };
      for (const position of player.positions) live[position.symbol] = position.gainPct;
      profileHistory.push(live);
    }
    return {
      ...player,
      rank,
      rankMovement,
      daysLed: leaderDays.get(player.id) ?? 0,
      personality: personalityFor(draftedPicks.map((position) => position.type)),
      achievements,
      bestPick: sortedPicks[0] ?? null,
      worstPick: sortedPicks.at(-1) ?? null,
      profileHistory,
    };
  });

  const through = race.finishedAt ?? (race.endAt && race.endAt < new Date() ? race.endAt : new Date());
  const weeklyMatchups = race.startedAt
    ? buildWeeklyMatchups(
        enrichedPlayers.map(({ id, name }) => ({ id, name })),
        points,
        race.startedAt,
        through
      )
    : [];
  const matchupTable = enrichedPlayers.map((player) => {
    let wins = 0;
    let draws = 0;
    let losses = 0;
    for (const matchup of weeklyMatchups.filter((row) =>
      row.complete && (row.playerA.id === player.id || row.playerB.id === player.id)
    )) {
      if (matchup.returnA === null || matchup.returnB === null) continue;
      if (matchup.winnerId === player.id) wins++;
      else if (matchup.winnerId === null) draws++;
      else losses++;
    }
    return { playerId: player.id, name: player.name, wins, draws, losses, points: wins * 3 + draws };
  }).sort((a, b) => b.points - a.points || b.wins - a.wins);

  const awards: Award[] = [];
  if (race.status === "finished" && enrichedPlayers.length > 0) {
    const champion = enrichedPlayers[0];
    awards.push({ title: "Portfolio Champion", player: champion.name, detail: formatPct(champion.gainPct) });
    const everyPick = enrichedPlayers.flatMap((player) => player.positions.map((position) => ({ player, position })));
    const best = [...everyPick].sort((a, b) => b.position.gainPct - a.position.gainPct)[0];
    const worst = [...everyPick].sort((a, b) => a.position.gainPct - b.position.gainPct)[0];
    if (best) awards.push({
      title: "Best Pick",
      player: best.player.name,
      detail: `${best.position.symbol} · ${formatPct(best.position.gainPct)}`,
    });
    if (worst) awards.push({ title: "Wooden Spoon", player: worst.player.name, detail: `${worst.position.symbol} · ${formatPct(worst.position.gainPct)}` });

    const returnsByPlayer = new Map<number, number[]>();
    for (const player of enrichedPlayers) {
      const values = snapshots.filter((snapshot) => snapshot.playerId === player.id).map((snapshot) => Number(snapshot.totalValue));
      const returns = values.slice(1).map((value, index) => percentGain(value, values[index]));
      returnsByPlayer.set(player.id, returns);
    }
    const consistent = [...enrichedPlayers]
      .filter((player) => (returnsByPlayer.get(player.id)?.length ?? 0) > 0)
      .sort((a, b) =>
        standardDeviation(returnsByPlayer.get(a.id) ?? []) - standardDeviation(returnsByPlayer.get(b.id) ?? [])
      )[0];
    if (consistent) awards.push({ title: "Steadiest Hands", player: consistent.name, detail: "Lowest day-to-day volatility" });

    const matchupWinner = matchupTable.find((player) => player.wins + player.draws + player.losses > 0);
    if (matchupWinner) awards.push({ title: "Head-to-Head Champion", player: matchupWinner.name, detail: `${matchupWinner.points} points` });
  }

  // History series are keyed by player id: display names are not unique.
  const byDate = new Map<string, Record<string, number | string>>();
  for (const snapshot of snapshots) {
    const date = snapshot.date.toISOString().slice(0, 10);
    if (!byDate.has(date)) byDate.set(date, { date });
    byDate.get(date)![String(snapshot.playerId)] = Number(snapshot.totalValue);
  }
  if (race.status === "running") {
    const live: Record<string, number | string> = { date: "Live" };
    for (const player of enrichedPlayers) live[String(player.id)] = player.currentValue;
    byDate.set("Live", live);
  }

  const daysRemaining = race.endAt
    ? Math.max(0, Math.ceil((race.endAt.getTime() - Date.now()) / 86_400_000))
    : null;

  return NextResponse.json({
    race: {
      name: race.name,
      currency: race.currency,
      startingCapital: capital,
      status: race.status,
      startedAt: race.startedAt?.toISOString() ?? null,
      endAt: race.endAt?.toISOString() ?? null,
      finishedAt: race.finishedAt?.toISOString() ?? null,
      daysRemaining,
      pricesAsOf: pricesAsOf?.toISOString() ?? race.finishedAt?.toISOString() ?? null,
      priceRefreshSeconds: 300,
    },
    players: enrichedPlayers,
    history: withPortfolioBaseline(
      [...byDate.values()],
      enrichedPlayers.map((player) => String(player.id)),
      capital
    ),
    weekly: {
      matchups: weeklyMatchups,
      table: matchupTable,
      currentWeek: weeklyMatchups.at(-1)?.week ?? 0,
    },
    awards,
  });
}
