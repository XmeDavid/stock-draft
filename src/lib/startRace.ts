import { prisma } from "@/lib/db";
import { getPrices, sourceKey, type PriceAsset } from "@/lib/prices";
import { computeQuantity, portfolioValue } from "@/lib/valuation";

type Deps = { db?: typeof prisma; fetchPrices?: typeof getPrices; now?: Date };

function httpError(message: string, status: number): Error {
  const e = new Error(message);
  (e as Error & { status?: number }).status = status;
  return e;
}

export async function startRace({ db = prisma, fetchPrices = getPrices, now = new Date() }: Deps = {}) {
  const race = await db.race.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  if (race.status !== "drafted") throw httpError(`Race is not ready to start (status: ${race.status})`, 409);

  const players = await db.player.findMany({ include: { positions: { include: { asset: true } } } });
  if (players.length === 0) throw httpError("No players configured", 409);

  const assets = players.flatMap((p) => p.positions.map((pos) => pos.asset as PriceAsset & { symbol: string }));
  const prices = await fetchPrices(assets, race.currency);

  const failures = assets.filter((a) => {
    const r = prices.get(sourceKey(a));
    return !r || "error" in r;
  });
  if (failures.length > 0) {
    const detail = failures
      .map((a) => {
        const r = prices.get(sourceKey(a));
        return `${a.symbol}: ${r && "error" in r ? r.error : "no result"}`;
      })
      .join("; ");
    throw httpError(`Price fetch failed — race not started. ${detail}`, 502);
  }

  const cashAsset = await db.asset.upsert({
    where: { symbol: "CASH" },
    update: {},
    create: { symbol: "CASH", name: "Cash", type: "cash", priceSource: "none", sourceId: "", quoteCurrency: race.currency },
  });

  const capital = Number(race.startingCapital);
  const day = new Date(now.toISOString().slice(0, 10)); // date-only

  await db.$transaction(async (tx) => {
    for (const player of players) {
      const valued: { quantity: number; price: number; assetId: number; symbol: string }[] = [];
      let allocated = 0;
      for (const pos of player.positions) {
        const res = prices.get(sourceKey(pos.asset as PriceAsset))!;
        const price = (res as { price: number }).price;
        const quantity = computeQuantity(Number(pos.allocation), price);
        allocated += Number(pos.allocation);
        await tx.position.update({ where: { id: pos.id }, data: { quantity, startPrice: price } });
        valued.push({ quantity, price, assetId: pos.assetId, symbol: (pos.asset as { symbol: string }).symbol });
      }
      const remainder = capital - allocated;
      if (remainder > 0.005) {
        await tx.position.create({
          data: { playerId: player.id, assetId: cashAsset.id, allocation: remainder, quantity: remainder, startPrice: 1 },
        });
        valued.push({ quantity: remainder, price: 1, assetId: cashAsset.id, symbol: "CASH" });
      }
      const breakdown = valued.map((v) => ({
        assetId: v.assetId,
        symbol: v.symbol,
        quantity: v.quantity,
        price: v.price,
        value: v.quantity * v.price,
      }));
      const totalValue = portfolioValue(valued);
      await tx.snapshot.upsert({
        where: { playerId_date: { playerId: player.id, date: day } },
        update: { totalValue, breakdown, stale: false },
        create: { playerId: player.id, date: day, totalValue, breakdown, stale: false },
      });
    }
    await tx.race.update({ where: { id: 1 }, data: { status: "running", startedAt: now } });
  });
}
