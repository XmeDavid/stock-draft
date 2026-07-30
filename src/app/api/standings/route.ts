import { NextResponse } from "next/server";
import { getPlayersWithPositions, getSnapshotsWithPlayers } from "@/lib/data";
import { getRace } from "@/lib/race";
import { advanceRaceClock } from "@/lib/raceClock";
import { getPrices, sourceKey, type PriceAsset, type PriceResult } from "@/lib/prices";
import { percentGain, positionValue } from "@/lib/valuation";
import { logoUrlForSymbol } from "@/lib/logos";
import {
  buildWeeklyMatchups,
  daysLed,
  personalityFor,
  ranksForValues,
  type SnapshotPoint,
} from "@/lib/gamification";

export const dynamic = "force-dynamic";

let cache: { at: number; prices: Map<string, PriceResult> } | null = null;

type BreakdownRow = { assetId: number; price: number; value: number; allocation?: number; isMvp?: boolean };
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
  const [players, snapshotRows] = await Promise.all([
    getPlayersWithPositions(),
    getSnapshotsWithPlayers(),
  ]);
  const snapshots = snapshotRows.map(({ snapshot, player }) => ({ ...snapshot, player }));

  let prices = new Map<string, PriceResult>();
  let pricesAsOf: Date | null = null;
  if (race.status === "running") {
    const forceRefresh = new URL(req.url).searchParams.get("refresh") === "1";
    if (!forceRefresh && cache && Date.now() - cache.at < 5 * 60_000) {
      prices = cache.prices;
    } else {
      const assets = players.flatMap((player) => player.positions.map((position) => position.asset as PriceAsset));
      prices = await getPrices(assets, race.currency);
      cache = { at: Date.now(), prices };
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
        const live = prices.get(sourceKey(position.asset as PriceAsset));
        const final = finalBreakdown.find((row) => row.assetId === position.assetId);
        const startPrice = Number(position.startPrice ?? 0);
        let currentPrice = startPrice;
        if (race.status === "running" && live && "price" in live) currentPrice = live.price;
        else if (race.status === "finished" && final) currentPrice = final.price;
        else if (race.status === "running") stale = true;

        const quantity = Number(position.quantity ?? 0);
        const allocation = Number(position.allocation);
        const value = positionValue(quantity, currentPrice, allocation, position.isMvp);
        const marketGainPct = startPrice > 0 ? percentGain(currentPrice, startPrice) : 0;
        const previousClose = race.status === "running" && live && "price" in live
          ? live.previousClose
          : undefined;
        return {
          assetId: position.assetId,
          symbol: position.asset.symbol,
          name: position.asset.name,
          type: position.asset.type,
          logoUrl: logoUrlForSymbol(position.asset.symbol),
          quantity,
          allocation,
          startPrice,
          currentPrice,
          value,
          todayGainPct: previousClose && previousClose > 0
            ? percentGain(currentPrice, previousClose)
            : position.asset.type === "cash"
              ? 0
              : null,
          marketGainPct,
          gainPct: allocation > 0 ? percentGain(value, allocation) : 0,
          isMvp: position.isMvp,
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
    const profileHistory = snapshots
      .filter((snapshot) => snapshot.playerId === player.id)
      .map((snapshot) => {
        const row: Record<string, number | string> = {
          date: snapshot.date.toISOString().slice(0, 10),
          Total: capital > 0 ? percentGain(Number(snapshot.totalValue), capital) : 0,
        };
        const breakdown = snapshot.breakdown as unknown as BreakdownRow[];
        for (const position of player.positions) {
          const point = breakdown.find((item) => item.assetId === position.assetId);
          row[position.symbol] = point && position.allocation > 0
            ? percentGain(point.value, position.allocation)
            : 0;
        }
        return row;
      });
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
    history: [...byDate.values()],
    weekly: {
      matchups: weeklyMatchups,
      table: matchupTable,
      currentWeek: weeklyMatchups.at(-1)?.week ?? 0,
    },
    awards,
  });
}
