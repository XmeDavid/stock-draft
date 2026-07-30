import { desc, eq } from "drizzle-orm";
import { snapshots } from "@db/schema";
import { getDb } from "@/lib/db";
import { getPlayersWithPositions } from "@/lib/data";
import { getRace } from "@/lib/race";
import { getPrices, sourceKey, type PriceAsset } from "@/lib/prices";
import { portfolioValue, positionValue } from "@/lib/valuation";

type BreakdownRow = {
  assetId: number;
  symbol: string;
  quantity: number;
  price: number;
  value: number;
  allocation?: number;
  isMvp?: boolean;
};

export async function runSnapshot(
  { fetchPrices = getPrices, now = new Date() }: { fetchPrices?: typeof getPrices; now?: Date } = {}
) {
  const race = await getRace();
  if (race.status !== "running") return { skipped: `race status is ${race.status}` };

  const playerRows = await getPlayersWithPositions();
  const priceAssets = playerRows.flatMap((player) =>
    player.positions.map((position) => position.asset as PriceAsset)
  );
  const prices = await fetchPrices(priceAssets, race.currency);
  const day = new Date(now.toISOString().slice(0, 10));
  const db = getDb();

  let anyStale = false;
  for (const player of playerRows) {
    const rows: BreakdownRow[] = [];
    let stale = false;
    for (const position of player.positions) {
      const result = prices.get(sourceKey(position.asset as PriceAsset));
      let price: number;
      if (result && "price" in result) {
        price = result.price;
      } else {
        stale = true;
        price = (await lastKnownPrice(player.id, position.assetId)) ?? position.startPrice ?? 0;
      }
      const quantity = position.quantity ?? 0;
      rows.push({
        assetId: position.assetId,
        symbol: position.asset.symbol,
        quantity,
        price,
        allocation: position.allocation,
        isMvp: position.isMvp,
        value: positionValue(quantity, price, position.allocation, position.isMvp),
      });
    }
    anyStale ||= stale;
    const totalValue = portfolioValue(rows);
    await db.insert(snapshots).values({
      playerId: player.id,
      date: day,
      capturedAt: now,
      totalValue,
      breakdown: rows,
      stale,
    }).onConflictDoUpdate({
      target: [snapshots.playerId, snapshots.date],
      set: { capturedAt: now, totalValue, breakdown: rows, stale },
    });
  }
  return { recorded: playerRows.length, stale: anyStale };
}

async function lastKnownPrice(playerId: number, assetId: number): Promise<number | null> {
  const [snapshot] = await getDb()
    .select({ breakdown: snapshots.breakdown })
    .from(snapshots)
    .where(eq(snapshots.playerId, playerId))
    .orderBy(desc(snapshots.date))
    .limit(1);
  const rows = (snapshot?.breakdown ?? []) as BreakdownRow[];
  return rows.find((row) => row.assetId === assetId)?.price ?? null;
}
