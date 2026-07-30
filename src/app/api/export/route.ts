import { prisma } from "@/lib/db";
import { getRace } from "@/lib/race";
import { percentGain } from "@/lib/valuation";
import { buildWorkbook } from "@/lib/export";

export const dynamic = "force-dynamic";

export async function GET() {
  const race = await getRace();
  const players = await prisma.player.findMany({ include: { positions: { include: { asset: true } } }, orderBy: { id: "asc" } });
  const snaps = await prisma.snapshot.findMany({ include: { player: true }, orderBy: { date: "asc" } });
  const capital = Number(race.startingCapital);

  const latestByPlayer = new Map<number, number>();
  for (const s of snaps) latestByPlayer.set(s.playerId, Number(s.totalValue));

  const buf = buildWorkbook({
    currency: race.currency,
    startingCapital: capital,
    players: players
      .map((p) => {
        const v = latestByPlayer.get(p.id) ?? capital;
        return { name: p.name, strategy: p.strategy, currentValue: v, gainPct: percentGain(v, capital) };
      })
      .sort((a, b) => b.currentValue - a.currentValue),
    history: snaps.map((s) => ({
      date: s.date.toISOString().slice(0, 10), playerName: s.player.name,
      totalValue: Number(s.totalValue), stale: s.stale,
    })),
    positions: players.flatMap((p) => p.positions.map((pos) => ({
      playerName: p.name, symbol: pos.asset.symbol, assetName: pos.asset.name,
      allocation: Number(pos.allocation), quantity: Number(pos.quantity ?? 0), startPrice: Number(pos.startPrice ?? 0),
    }))),
  });

  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="race-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  });
}
