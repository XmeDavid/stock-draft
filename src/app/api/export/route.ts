import { getPlayersWithPositions, getSnapshotsWithPlayers } from "@/lib/data";
import { getRace } from "@/lib/race";
import { percentGain } from "@/lib/valuation";
import { buildWorkbook } from "@/lib/export";
import { isAdminRequest, mvpRevealed } from "@/lib/mvpReveal";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const race = await getRace();
  const [players, snapshotRows] = await Promise.all([
    getPlayersWithPositions(),
    getSnapshotsWithPlayers(),
  ]);
  const capital = Number(race.startingCapital);
  // Public download: same reveal rule as /api/draft and the standings.
  const showMvp = isAdminRequest(req) || mvpRevealed(players.length, players.flatMap((p) => p.positions));

  const latestByPlayer = new Map<number, number>();
  for (const { snapshot } of snapshotRows) latestByPlayer.set(snapshot.playerId, snapshot.totalValue);

  const buf = buildWorkbook({
    currency: race.currency,
    startingCapital: capital,
    players: players
      .map((p) => {
        const v = latestByPlayer.get(p.id) ?? capital;
        return { name: p.name, strategy: p.strategy, currentValue: v, gainPct: percentGain(v, capital) };
      })
      .sort((a, b) => b.currentValue - a.currentValue),
    history: snapshotRows.map(({ snapshot, player }) => ({
      date: snapshot.date.toISOString().slice(0, 10), playerName: player.name,
      totalValue: snapshot.totalValue, stale: snapshot.stale,
    })),
    positions: players.flatMap((p) => p.positions.map((pos) => ({
      playerName: p.name, symbol: pos.asset.symbol, assetName: pos.asset.name,
      allocation: Number(pos.allocation), quantity: Number(pos.quantity ?? 0), startPrice: Number(pos.startPrice ?? 0),
      isMvp: showMvp && pos.isMvp,
    }))),
  });

  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="race-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  });
}
