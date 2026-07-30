import { prisma } from "@/lib/db";
import { getPrices, sourceKey, type PriceAsset } from "@/lib/prices";
import { portfolioValue } from "@/lib/valuation";

type Deps = { db?: typeof prisma; fetchPrices?: typeof getPrices; now?: Date };
type BreakdownRow = { assetId: number; symbol: string; quantity: number; price: number; value: number };

export async function runSnapshot({ db = prisma, fetchPrices = getPrices, now = new Date() }: Deps = {}) {
  const race = await db.race.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  if (race.status !== "running") return { skipped: `race status is ${race.status}` };

  const players = await db.player.findMany({ include: { positions: { include: { asset: true } } } });
  const assets = players.flatMap((p) => p.positions.map((pos) => pos.asset as PriceAsset));
  const prices = await fetchPrices(assets, race.currency);
  const day = new Date(now.toISOString().slice(0, 10));

  let anyStale = false;
  for (const player of players) {
    const rows: BreakdownRow[] = [];
    let stale = false;
    for (const pos of player.positions) {
      const a = pos.asset as PriceAsset & { symbol: string };
      const res = prices.get(sourceKey(a));
      let price: number;
      if (res && "price" in res) {
        price = res.price;
      } else {
        stale = true;
        price = (await lastKnownPrice(db, player.id, pos.assetId)) ?? Number(pos.startPrice);
      }
      const quantity = Number(pos.quantity);
      rows.push({ assetId: pos.assetId, symbol: a.symbol, quantity, price, value: quantity * price });
    }
    anyStale = anyStale || stale;
    const totalValue = portfolioValue(rows);
    await db.snapshot.upsert({
      where: { playerId_date: { playerId: player.id, date: day } },
      update: { totalValue, breakdown: rows, stale },
      create: { playerId: player.id, date: day, totalValue, breakdown: rows, stale },
    });
  }
  return { recorded: players.length, stale: anyStale };
}

async function lastKnownPrice(db: typeof prisma, playerId: number, assetId: number): Promise<number | null> {
  const snap = await db.snapshot.findFirst({ where: { playerId }, orderBy: { date: "desc" } });
  if (!snap) return null;
  const rows = snap.breakdown as unknown as BreakdownRow[];
  return rows.find((r) => r.assetId === assetId)?.price ?? null;
}
