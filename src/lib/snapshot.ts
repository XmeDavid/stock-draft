import { desc, eq } from "drizzle-orm";
import { snapshots } from "@db/schema";
import { getDb } from "@/lib/db";
import { getPlayersWithPositions } from "@/lib/data";
import { getRace } from "@/lib/race";
import { getPrices, sourceKey, type PriceAsset } from "@/lib/prices";
import { portfolioValue } from "@/lib/valuation";
import { buildSnapshotRow, historicalAssetIds } from "@/lib/corporateActions";
import { applySplitsFromQuotes, readActionLog, reconcileBeforeSnapshot } from "@/lib/applyCorporateActions";

type BreakdownRow = {
  assetId: number;
  symbol: string;
  quantity: number;
  price: number;
  value: number;
  allocation?: number;
  isMvp?: boolean;
  pricingStatus?: "live" | "unpriced";
  possibleCorporateAction?: boolean;
  priceBasis?: string;
};

export async function runSnapshot(
  { fetchPrices = getPrices, now = new Date() }: { fetchPrices?: typeof getPrices; now?: Date } = {}
) {
  const race = await getRace();
  if (race.status !== "running") return { skipped: `race status is ${race.status}` };

  try {
    await reconcileBeforeSnapshot();
  } catch (error) {
    console.error("corporate action sync failed", error);
  }

  let playerRows = await getPlayersWithPositions();
  const priceAssets = playerRows.flatMap((player) =>
    player.positions.map((position) => position.asset as PriceAsset)
  );
  const prices = await fetchPrices(priceAssets, race.currency);
  try {
    if (await applySplitsFromQuotes(prices)) playerRows = await getPlayersWithPositions();
  } catch (error) {
    console.error("split apply failed", error);
  }
  const lineage = (await readActionLog().catch(() => null))?.lineageByPosition ?? {};
  const day = new Date(now.toISOString().slice(0, 10));
  const db = getDb();

  let anyStale = false;
  for (const player of playerRows) {
    const rows: BreakdownRow[] = [];
    let stale = false;
    for (const position of player.positions) {
      const result = prices.get(sourceKey(position.asset as PriceAsset));
      const assetIds = historicalAssetIds(position.assetId, lineage[String(position.id)]);
      const lastPrice = await lastKnownPrice(player.id, assetIds);
      const row = buildSnapshotRow({
        assetId: position.assetId,
        symbol: position.asset.symbol,
        quantity: position.quantity ?? 0,
        allocation: position.allocation,
        isMvp: position.isMvp,
        startPrice: position.startPrice ?? 0,
        priceSource: position.asset.priceSource,
        type: position.asset.type,
        live: result,
        lastSnapshotPrice: lastPrice,
      });
      if (row.possibleCorporateAction) stale = true;
      rows.push(row);
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

async function lastKnownPrice(playerId: number, assetIds: number[]): Promise<number | null> {
  const [snapshot] = await getDb()
    .select({ breakdown: snapshots.breakdown })
    .from(snapshots)
    .where(eq(snapshots.playerId, playerId))
    .orderBy(desc(snapshots.date))
    .limit(1);
  const rows = (snapshot?.breakdown ?? []) as BreakdownRow[];
  const ids = new Set(assetIds);
  const price = rows.find((row) => ids.has(row.assetId))?.price;
  return typeof price === "number" && Number.isFinite(price) ? price : null;
}
