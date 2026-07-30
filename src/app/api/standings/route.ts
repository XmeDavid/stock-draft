import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getRace } from "@/lib/race";
import { getPrices, sourceKey, type PriceAsset, type PriceResult } from "@/lib/prices";
import { percentGain } from "@/lib/valuation";

export const dynamic = "force-dynamic";

let cache: { at: number; prices: Map<string, PriceResult> } | null = null;

export async function GET() {
  const race = await getRace();
  const players = await prisma.player.findMany({
    include: { positions: { include: { asset: true } } },
    orderBy: { id: "asc" },
  });

  let prices = new Map<string, PriceResult>();
  if (race.status === "running") {
    if (cache && Date.now() - cache.at < 5 * 60_000) {
      prices = cache.prices;
    } else {
      const assets = players.flatMap((p) => p.positions.map((pos) => pos.asset as PriceAsset));
      prices = await getPrices(assets, race.currency);
      cache = { at: Date.now(), prices };
    }
  }

  const capital = Number(race.startingCapital);
  const playerRows = players.map((p) => {
    let stale = false;
    const positions = p.positions.map((pos) => {
      const res = prices.get(sourceKey(pos.asset as PriceAsset));
      const startPrice = Number(pos.startPrice ?? 0);
      let currentPrice = startPrice;
      if (res && "price" in res) currentPrice = res.price;
      else if (race.status === "running") stale = true;
      const quantity = Number(pos.quantity ?? 0);
      return {
        symbol: pos.asset.symbol, name: pos.asset.name, quantity, startPrice, currentPrice,
        value: quantity * currentPrice,
        gainPct: startPrice > 0 ? percentGain(currentPrice, startPrice) : 0,
      };
    });
    const currentValue = positions.reduce((s, x) => s + x.value, 0);
    return {
      id: p.id, name: p.name, strategy: p.strategy, color: p.color,
      currentValue, gainPct: capital > 0 ? percentGain(currentValue, capital) : 0,
      stale, positions,
    };
  }).sort((a, b) => b.currentValue - a.currentValue);

  // History series are keyed by player id: display names are not unique.
  const snaps = await prisma.snapshot.findMany({ orderBy: { date: "asc" } });
  const byDate = new Map<string, Record<string, number | string>>();
  for (const s of snaps) {
    const d = s.date.toISOString().slice(0, 10);
    if (!byDate.has(d)) byDate.set(d, { date: d });
    byDate.get(d)![String(s.playerId)] = Number(s.totalValue);
  }

  return NextResponse.json({
    race: { name: race.name, currency: race.currency, startingCapital: capital, status: race.status, startedAt: race.startedAt?.toISOString() ?? null },
    players: playerRows,
    history: [...byDate.values()],
  });
}
