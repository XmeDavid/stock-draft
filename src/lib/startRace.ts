import { eq } from "drizzle-orm";
import { assets, positions, races, snapshots } from "@db/schema";
import { getDb } from "@/lib/db";
import { getPlayersWithPositions } from "@/lib/data";
import { getRace } from "@/lib/race";
import { getPrices, sourceKey, type PriceAsset } from "@/lib/prices";
import { computeQuantity, portfolioValue } from "@/lib/valuation";

function httpError(message: string, status: number): Error {
  const error = new Error(message);
  (error as Error & { status?: number }).status = status;
  return error;
}

export async function startRace(
  { fetchPrices = getPrices, now = new Date() }: { fetchPrices?: typeof getPrices; now?: Date } = {}
) {
  const race = await getRace();
  if (race.status !== "drafted") {
    throw httpError(`Race is not ready to start (status: ${race.status})`, 409);
  }
  if (!race.endAt || race.endAt <= now) {
    throw httpError("Set a future race end date before starting", 409);
  }

  const playerRows = await getPlayersWithPositions();
  if (playerRows.length === 0) throw httpError("No players configured", 409);
  const missingMvp = playerRows.filter(
    (player) => player.positions.filter((position) => position.isMvp).length !== 1
  );
  if (missingMvp.length > 0) {
    throw httpError(`${missingMvp.length} player(s) still need to lock exactly one MVP`, 409);
  }

  const priceAssets = playerRows.flatMap((player) =>
    player.positions.map((position) => position.asset as PriceAsset & { symbol: string })
  );
  const prices = await fetchPrices(priceAssets, race.currency);
  const failures = priceAssets.filter((asset) => {
    const result = prices.get(sourceKey(asset));
    return !result || "error" in result;
  });
  if (failures.length > 0) {
    const detail = failures.map((asset) => {
      const result = prices.get(sourceKey(asset));
      return `${asset.symbol}: ${result && "error" in result ? result.error : "no result"}`;
    }).join("; ");
    throw httpError(`Price fetch failed — race not started. ${detail}`, 502);
  }

  const db = getDb();
  await db.insert(assets).values({
    symbol: "CASH",
    name: "Cash",
    type: "cash",
    priceSource: "none",
    sourceId: "",
    quoteCurrency: race.currency,
  }).onConflictDoNothing();
  const [cashAsset] = await db.select().from(assets).where(eq(assets.symbol, "CASH")).limit(1);
  if (!cashAsset) throw new Error("Cash asset could not be initialized");

  const day = new Date(now.toISOString().slice(0, 10));
  const capital = race.startingCapital;
  for (const player of playerRows) {
    const valued: {
      assetId: number;
      symbol: string;
      quantity: number;
      price: number;
      allocation: number;
      isMvp: boolean;
    }[] = [];
    let allocated = 0;
    for (const position of player.positions) {
      const price = (prices.get(sourceKey(position.asset as PriceAsset)) as { price: number }).price;
      const quantity = computeQuantity(position.allocation, price);
      allocated += position.allocation;
      await db.update(positions)
        .set({ quantity, startPrice: price })
        .where(eq(positions.id, position.id));
      valued.push({
        assetId: position.assetId,
        symbol: position.asset.symbol,
        quantity,
        price,
        allocation: position.allocation,
        isMvp: position.isMvp,
      });
    }

    const remainder = capital - allocated;
    if (remainder > 0.005) {
      await db.insert(positions).values({
        playerId: player.id,
        assetId: cashAsset.id,
        allocation: remainder,
        quantity: remainder,
        startPrice: 1,
      }).onConflictDoNothing();
      valued.push({
        assetId: cashAsset.id,
        symbol: "CASH",
        quantity: remainder,
        price: 1,
        allocation: remainder,
        isMvp: false,
      });
    }

    const breakdown = valued.map((value) => ({
      ...value,
      value: value.allocation,
    }));
    await db.insert(snapshots).values({
      playerId: player.id,
      date: day,
      capturedAt: now,
      totalValue: portfolioValue(valued),
      breakdown,
      stale: false,
    }).onConflictDoUpdate({
      target: [snapshots.playerId, snapshots.date],
      set: { capturedAt: now, totalValue: portfolioValue(valued), breakdown, stale: false },
    });
  }

  await db.update(races)
    .set({ status: "running", startedAt: now, scheduledStartAt: null })
    .where(eq(races.id, 1));
}
