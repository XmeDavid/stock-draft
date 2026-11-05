import { eq } from "drizzle-orm";
import { assets, players, positions } from "@db/schema";
import { getDb, type AppDb } from "@/lib/db";
import { getRace } from "@/lib/race";
import { fetchYahooSplitEvents, resolveTicker } from "@/lib/prices";
import { mergerMappings } from "@/lib/mergerMap";
import {
  ACTION_LOG_SYMBOL,
  CorporateActionError,
  applyRatio,
  emptyActionLog,
  parseActionLog,
  adminSplitRecord,
  planCashBuyout,
  planEdit,
  planFromMapping,
  planRename,
  planSplit,
  planStockConversion,
  punctuationVariants,
  ratioOfSplits,
  tickerKey,
  unappliedSplits,
  type ActionLog,
  type CorporatePlan,
  type Holding,
  type Listing,
  type YahooSplit,
} from "@/lib/corporateActions";

const WIDE_SYNC_INTERVAL_MS = 12 * 60 * 60 * 1000;

type Executor = Pick<AppDb, "select" | "insert" | "update">;

function httpError(message: string, status: number): Error {
  const error = new Error(message);
  (error as Error & { status?: number }).status = status;
  return error;
}

export async function readActionLog(): Promise<ActionLog> {
  const [row] = await getDb().select({ name: assets.name }).from(assets)
    .where(eq(assets.symbol, ACTION_LOG_SYMBOL))
    .limit(1);
  return row ? parseActionLog(row.name) : emptyActionLog();
}

export async function readLineageByPosition(): Promise<Map<number, number[]>> {
  const log = await readActionLog();
  return new Map(
    Object.entries(log.lineageByPosition).map(([positionId, assetIds]) => [Number(positionId), assetIds]),
  );
}

async function lockLog(tx: Executor): Promise<{ id: number; log: ActionLog }> {
  await tx.insert(assets).values({
    symbol: ACTION_LOG_SYMBOL,
    name: JSON.stringify(emptyActionLog()),
    type: "system",
    priceSource: "none",
    sourceId: "corp-actions",
    quoteCurrency: "USD",
  }).onConflictDoNothing();
  const [row] = await tx.select().from(assets).where(eq(assets.symbol, ACTION_LOG_SYMBOL)).limit(1).for("update");
  if (!row) throw new Error("Corporate action log could not be loaded");
  return { id: row.id, log: parseActionLog(row.name) };
}

async function loadBook(db: Executor): Promise<{ holdings: Holding[]; listings: Listing[] }> {
  // Sequential on purpose: a transaction holds one connection, and overlapping
  // queries on it can fail or interleave.
  const positionRows = await db.select({
    positionId: positions.id,
    playerId: positions.playerId,
    playerName: players.name,
    assetId: assets.id,
    symbol: assets.symbol,
    name: assets.name,
    type: assets.type,
    priceSource: assets.priceSource,
    sourceId: assets.sourceId,
    quoteCurrency: assets.quoteCurrency,
    quantity: positions.quantity,
    startPrice: positions.startPrice,
    allocation: positions.allocation,
    isMvp: positions.isMvp,
  })
    .from(positions)
    .innerJoin(assets, eq(positions.assetId, assets.id))
    .innerJoin(players, eq(positions.playerId, players.id));
  const listingRows = await db.select().from(assets);

  const listings = listingRows
    .filter((listing) => listing.symbol !== ACTION_LOG_SYMBOL)
    .map((listing) => ({
      id: listing.id,
      symbol: listing.symbol,
      name: listing.name,
      type: listing.type,
      priceSource: listing.priceSource,
      sourceId: listing.sourceId,
      quoteCurrency: listing.quoteCurrency,
    }));
  const holdings = positionRows.flatMap((row) => {
    if (row.symbol === ACTION_LOG_SYMBOL || row.quantity === null || row.startPrice === null) return [];
    return [{
      positionId: row.positionId,
      playerId: row.playerId,
      playerName: row.playerName,
      assetId: row.assetId,
      symbol: row.symbol,
      name: row.name,
      type: row.type,
      priceSource: row.priceSource,
      sourceId: row.sourceId,
      quoteCurrency: row.quoteCurrency,
      quantity: row.quantity,
      startPrice: row.startPrice,
      allocation: row.allocation,
      isMvp: row.isMvp,
    }];
  });
  return { holdings, listings };
}

async function writePlan(
  tx: Executor,
  plan: CorporatePlan,
  log: ActionLog,
  logId: number,
  splitRatio?: number,
): Promise<void> {
  if (plan.assetPatch) {
    const patch = plan.assetPatch;
    await tx.update(assets).set({
      symbol: patch.symbol,
      name: patch.name,
      type: patch.type,
      priceSource: patch.priceSource,
      sourceId: patch.sourceId,
      quoteCurrency: patch.quoteCurrency,
    }).where(eq(assets.id, patch.assetId));
  }
  for (const patch of plan.positionPatches) {
    await tx.update(positions).set({
      quantity: patch.quantity,
      startPrice: patch.startPrice,
      assetId: patch.assetId,
      ...(patch.allocation === undefined ? {} : { allocation: patch.allocation }),
    }).where(eq(positions.id, patch.positionId));

    const key = String(patch.positionId);
    if (patch.previousAssetId !== null) {
      const lineage = log.lineageByPosition[key] ?? [];
      if (!lineage.includes(patch.previousAssetId)) lineage.push(patch.previousAssetId);
      log.lineageByPosition[key] = lineage;
    }
    if (patch.splitsAfter !== null) {
      log.splitsAfterByPosition[key] = patch.splitsAfter;
      log.appliedSplitsByPosition[key] = [];
    }
    if (splitRatio) {
      const nowSec = Math.floor(Date.now() / 1000);
      const applied = log.appliedSplitsByPosition[key] ?? [];
      applied.push(adminSplitRecord(patch.positionId, splitRatio, nowSec));
      log.appliedSplitsByPosition[key] = applied;
    }
  }
  await tx.update(assets).set({ name: JSON.stringify(log) }).where(eq(assets.id, logId));
}

async function commitBuilt(
  build: (holdings: Holding[], listings: Listing[]) => CorporatePlan,
  splitRatio?: number,
): Promise<string> {
  const race = await getRace();
  if (race.status !== "running") {
    throw httpError(`Corporate actions can be recorded while the race is running (status: ${race.status})`, 409);
  }
  return getDb().transaction(async (tx) => {
    const { id, log } = await lockLog(tx);
    const { holdings, listings } = await loadBook(tx);
    const plan = build(holdings, listings);
    await writePlan(tx, plan, log, id, splitRatio);
    return plan.summary;
  });
}

export async function applyConfiguredMappings(now = new Date()): Promise<string[]> {
  if (mergerMappings.length === 0) return [];
  const race = await getRace();
  if (race.status !== "running") return [];
  const summaries: string[] = [];
  for (const mapping of mergerMappings) {
    try {
      const summary = await commitBuilt(
        (holdings, listings) => planFromMapping(holdings, listings, mapping, now),
        mapping.kind === "split" ? mapping.ratio : undefined,
      );
      summaries.push(summary);
    } catch (error) {
      if (error instanceof CorporateActionError) continue;
      const status = (error as { status?: number }).status;
      if (status === 409) continue;
      throw error;
    }
  }
  return summaries;
}

export async function applyPendingSplits(
  splitsByTicker: Map<string, YahooSplit[]>,
): Promise<{ positionId: number; symbol: string; ratio: number }[]> {
  if (splitsByTicker.size === 0) return [];
  const race = await getRace();
  if (race.status !== "running" || !race.startedAt) return [];
  const startedAtUnix = race.startedAt.getTime() / 1000;
  return getDb().transaction(async (tx) => {
    const { id: logId, log } = await lockLog(tx);
    const { holdings } = await loadBook(tx);
    const applied: { positionId: number; symbol: string; ratio: number }[] = [];
    for (const holding of holdings) {
      if (holding.priceSource !== "yahoo") continue;
      const splits = splitsByTicker.get(holding.sourceId);
      if (!splits || splits.length === 0) continue;
      const key = String(holding.positionId);
      const after = log.splitsAfterByPosition[key] ?? startedAtUnix;
      const pending = unappliedSplits(splits, after, log.appliedSplitsByPosition[key]);
      const ratio = ratioOfSplits(pending);
      if (Math.abs(ratio - 1) < 1e-9) continue;
      const adjusted = applyRatio(holding.quantity, holding.startPrice, ratio);
      await tx.update(positions).set({
        quantity: adjusted.quantity,
        startPrice: adjusted.startPrice,
      }).where(eq(positions.id, holding.positionId));
      log.appliedSplitsByPosition[key] = [
        ...(log.appliedSplitsByPosition[key] ?? []),
        ...pending.map((split) => ({
          id: split.id,
          date: split.date,
          ratio: split.numerator / split.denominator,
        })),
      ];
      applied.push({ positionId: holding.positionId, symbol: holding.symbol, ratio });
    }
    if (applied.length > 0) {
      await tx.update(assets).set({ name: JSON.stringify(log) }).where(eq(assets.id, logId));
    }
    return applied;
  });
}

export async function applySplitsFromQuotes(
  quotes: Map<string, { splits?: YahooSplit[] } | { error: string }>,
): Promise<boolean> {
  const splitsByTicker = new Map<string, YahooSplit[]>();
  for (const [key, value] of quotes) {
    if (!key.startsWith("yahoo:") || !("splits" in value) || !value.splits?.length) continue;
    splitsByTicker.set(key.slice("yahoo:".length), value.splits);
  }
  const applied = await applyPendingSplits(splitsByTicker);
  return applied.length > 0;
}

export async function syncWideSplits(options?: {
  force?: boolean;
  fetchSplits?: typeof fetchYahooSplitEvents;
}): Promise<{ positionId: number; symbol: string; ratio: number }[]> {
  const race = await getRace();
  if (race.status !== "running" || !race.startedAt) return [];
  const current = await readActionLog();
  if (
    !options?.force
    && current.wideSyncAt !== undefined
    && Date.now() - current.wideSyncAt < WIDE_SYNC_INTERVAL_MS
  ) {
    return [];
  }

  const { holdings } = await loadBook(getDb());
  const tickers = [...new Set(
    holdings.filter((holding) => holding.priceSource === "yahoo" && holding.sourceId).map((holding) => holding.sourceId),
  )];
  const fetchSplits = options?.fetchSplits ?? fetchYahooSplitEvents;
  const splitsByTicker = new Map<string, YahooSplit[]>();
  let anySuccess = tickers.length === 0;
  for (const ticker of tickers) {
    try {
      splitsByTicker.set(ticker, await fetchSplits(ticker));
      anySuccess = true;
    } catch (error) {
      console.error(`split lookup failed for ${ticker}`, error);
    }
  }
  const applied = await applyPendingSplits(splitsByTicker);
  if (anySuccess) {
    await getDb().transaction(async (tx) => {
      const { id, log } = await lockLog(tx);
      log.wideSyncAt = Date.now();
      await tx.update(assets).set({ name: JSON.stringify(log) }).where(eq(assets.id, id));
    });
  }
  return applied;
}

export async function reconcileBeforeSnapshot(): Promise<void> {
  // Mapped deals only. The wide Yahoo split history is an admin action so a
  // snapshot cannot turn a rate limit into a field of false delistings.
  await applyConfiguredMappings();
}

export async function recoverPunctuation(
  failed: { symbol: string; sourceId: string }[],
): Promise<boolean> {
  const seen = new Set<string>();
  let changed = false;
  for (const asset of failed) {
    const symbol = asset.symbol.trim().toUpperCase();
    if (!symbol || !asset.sourceId || seen.has(symbol)) continue;
    seen.add(symbol);
    for (const variant of punctuationVariants(asset.sourceId)) {
      let listing;
      try {
        listing = await resolveTicker(variant);
      } catch {
        continue;
      }
      if (tickerKey(listing.symbol) !== tickerKey(asset.sourceId)) continue;
      try {
        await commitBuilt((holdings, listings) => planRename(holdings, listings, {
          symbol,
          toSymbol: listing.symbol,
          name: listing.name,
        }));
        changed = true;
        break;
      } catch (error) {
        if (error instanceof CorporateActionError) break;
        throw error;
      }
    }
  }
  return changed;
}

export type AdminCorporateAction =
  | { kind: "split"; symbol: string; ratio: number }
  | { kind: "stock"; symbol: string; acquirerSymbol: string; ratio: number; acquirerName?: string; quoteCurrency?: string }
  | { kind: "cash"; symbol: string; cashPerShare: number }
  | { kind: "rename"; symbol: string; toSymbol: string; name?: string }
  | { kind: "edit"; positionId: number; quantity?: number; startPrice?: number; allocation?: number }
  | { kind: "sync" };

export async function executeCorporateAction(action: AdminCorporateAction): Promise<{ summary: string }> {
  if (action.kind === "sync") {
    const race = await getRace();
    if (race.status !== "running") {
      throw httpError(`Corporate actions can be recorded while the race is running (status: ${race.status})`, 409);
    }
    const mapped = await applyConfiguredMappings();
    const splits = await syncWideSplits({ force: true });
    const parts = [
      ...mapped,
      ...splits.map((split) => `Split ${split.symbol} ×${split.ratio} on position ${split.positionId}`),
    ];
    return { summary: parts.length > 0 ? parts.join("; ") : "No mapped deals or unapplied splits." };
  }

  const summary = await commitBuilt((holdings, listings) => {
    switch (action.kind) {
      case "split":
        return planSplit(holdings, action.symbol, action.ratio);
      case "cash":
        return planCashBuyout(holdings, listings, action.symbol, action.cashPerShare);
      case "rename":
        return planRename(holdings, listings, { symbol: action.symbol, toSymbol: action.toSymbol, name: action.name });
      case "stock":
        return planStockConversion(holdings, listings, {
          symbol: action.symbol,
          acquirerSymbol: action.acquirerSymbol,
          ratio: action.ratio,
          acquirerName: action.acquirerName,
          quoteCurrency: action.quoteCurrency,
        });
      case "edit":
        return planEdit(holdings, action);
    }
  }, action.kind === "split" ? action.ratio : undefined);
  return { summary };
}

export async function listCorporateActionBook(): Promise<{
  status: string;
  positions: {
    positionId: number;
    playerId: number;
    playerName: string;
    symbol: string;
    name: string;
    quantity: number;
    startPrice: number;
    allocation: number;
    isMvp: boolean;
    assetId: number;
    type: string;
  }[];
}> {
  const race = await getRace();
  const { holdings } = await loadBook(getDb());
  return {
    status: race.status,
    positions: holdings.map((holding) => ({
      positionId: holding.positionId,
      playerId: holding.playerId,
      playerName: holding.playerName,
      symbol: holding.symbol,
      name: holding.name,
      quantity: holding.quantity,
      startPrice: holding.startPrice,
      allocation: holding.allocation,
      isMvp: holding.isMvp,
      assetId: holding.assetId,
      type: holding.type,
    })),
  };
}
