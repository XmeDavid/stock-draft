import { asc } from "drizzle-orm";
import { snapshots } from "@db/schema";
import { getDb } from "@/lib/db";
import { getPlayersWithPositions, type PlayerWithPositions } from "@/lib/data";
import { getRace } from "@/lib/race";
import { getPrices, sourceKey, type PriceAsset, type PriceResult } from "@/lib/prices";
import { portfolioValue } from "@/lib/valuation";
import {
  buildSnapshotRow,
  historicalAssetIds,
  lastKnownPriceFor,
  mappingHint,
  type ActionLog,
  type SnapshotHistory,
  type SnapshotValuationRow,
} from "@/lib/corporateActions";
import { mergerMappings } from "@/lib/mergerMap";
import {
  applySplitsFromQuotes,
  readActionLog,
  readActionLogOrReport,
  reconcileBeforeSnapshot,
  writeAtActionRevision,
} from "@/lib/applyCorporateActions";

/** Attempts before giving up when corporate actions keep landing mid-snapshot. */
const MAX_ATTEMPTS = 3;

function priceAssetsOf(playerRows: PlayerWithPositions[]): PriceAsset[] {
  return playerRows.flatMap((player) => player.positions.map((position) => position.asset as PriceAsset));
}

function buildRows(
  playerRows: PlayerWithPositions[],
  prices: Map<string, PriceResult>,
  history: SnapshotHistory[],
  log: ActionLog | null,
) {
  return playerRows.map((player) => {
    const rows: SnapshotValuationRow[] = player.positions.map((position) => {
      const key = String(position.id);
      const quantity = position.quantity ?? 0;
      return buildSnapshotRow({
        positionId: position.id,
        assetId: position.assetId,
        symbol: position.asset.symbol,
        quantity,
        allocation: position.allocation,
        isMvp: position.isMvp,
        startPrice: position.startPrice ?? 0,
        priceSource: position.asset.priceSource,
        type: position.asset.type,
        live: prices.get(sourceKey(position.asset as PriceAsset)),
        lastSnapshotPrice: lastKnownPriceFor(history, {
          playerId: player.id,
          positionId: position.id,
          assetIds: historicalAssetIds(position.assetId, log?.lineageByPosition[key]),
          quantity,
          effectiveAt: log?.effectiveAtByPosition[key],
        }),
        corporateActionSignal: mappingHint(position.asset.symbol, mergerMappings) !== null,
      });
    });
    return {
      playerId: player.id,
      rows,
      stale: rows.some((row) => row.pricingStatus === "unpriced"),
      totalValue: portfolioValue(rows),
    };
  });
}

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

  const before = await readActionLogOrReport("snapshot");
  let prices = await fetchPrices(priceAssetsOf(await getPlayersWithPositions()), race.currency);
  let appliedOwnSplit = false;
  try {
    appliedOwnSplit = await applySplitsFromQuotes(prices);
  } catch (error) {
    console.error("split apply failed", error);
  }
  // Quotes are only trusted against the revision they were fetched at (plus the split they triggered).
  let pricedAt = before ? before.revision + (appliedOwnSplit ? 1 : 0) : null;

  const history: SnapshotHistory[] = (await getDb()
    .select({ playerId: snapshots.playerId, capturedAt: snapshots.capturedAt, breakdown: snapshots.breakdown })
    .from(snapshots)
    .orderBy(asc(snapshots.date)))
    .map((row) => ({ ...row, breakdown: (row.breakdown ?? []) as SnapshotHistory["breakdown"] }));
  const day = new Date(now.toISOString().slice(0, 10));

  for (let attempt = 1; ; attempt++) {
    // Always reload holdings: another request may have applied a split or deal
    // while the quotes were in flight, and its quantities must meet matching prices.
    const log = before ? await readActionLog() : null;
    const playerRows = await getPlayersWithPositions();
    if (log && log.revision !== pricedAt) {
      prices = await fetchPrices(priceAssetsOf(playerRows), race.currency);
      pricedAt = log.revision;
    } else {
      const missing = priceAssetsOf(playerRows).filter((asset) => !prices.has(sourceKey(asset)));
      if (missing.length > 0) prices = new Map([...prices, ...await fetchPrices(missing, race.currency)]);
    }
    const built = buildRows(playerRows, prices, history, log);
    const write = async (db: Pick<ReturnType<typeof getDb>, "insert">) => {
      for (const { playerId, rows, stale, totalValue } of built) {
        await db.insert(snapshots).values({
          playerId,
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
    };
    // With an unreadable log no action can commit (writers fail closed), so there is nothing to race.
    const written = log ? await writeAtActionRevision(log.revision, write) : (await write(getDb()), true);
    if (written) {
      return { recorded: built.length, stale: built.some((player) => player.stale) };
    }
    if (attempt >= MAX_ATTEMPTS) {
      throw new Error("Corporate actions kept changing while the snapshot was taken; it will be retried");
    }
  }
}
