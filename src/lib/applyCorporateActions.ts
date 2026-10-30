import { eq } from "drizzle-orm";
import { assets, players, positions } from "@db/schema";
import { getDb, type AppDb } from "@/lib/db";
import { getRace } from "@/lib/race";
import { fetchYahooSplitEvents, resolveTicker } from "@/lib/prices";
import { mergerMappings } from "@/lib/mergerMap";
import { clearQuoteCaches } from "@/lib/quoteCache";
import {
  ACTION_LOG_SYMBOL,
  AlreadyAppliedError,
  CorporateActionError,
  MAX_REQUEST_IDS,
  applyRatio,
  emptyActionLog,
  implausibleSplits,
  mappingActionId,
  parseActionLog,
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
/** Allows an ex-date "today" entered from a timezone ahead of UTC. */
const FUTURE_SLACK_SEC = 24 * 60 * 60;

type Executor = Pick<AppDb, "select" | "insert" | "update">;

function httpError(message: string, status: number): Error {
  const error = new Error(message);
  (error as Error & { status?: number }).status = status;
  return error;
}

/** Throws `CorruptActionLogError` if the stored log cannot be parsed; it is never reset to empty. */
export async function readActionLog(): Promise<ActionLog> {
  const [row] = await getDb().select({ name: assets.name }).from(assets)
    .where(eq(assets.symbol, ACTION_LOG_SYMBOL))
    .limit(1);
  return row ? parseActionLog(row.name) : emptyActionLog();
}

/** Read-only callers keep serving but say why. Writers go through `lockLog`, which fails closed. */
export async function readActionLogOrReport(context: string): Promise<ActionLog | null> {
  try {
    return await readActionLog();
  } catch (error) {
    console.error(`corporate action log unreadable (${context}); corporate-action writes are blocked until it is repaired`, error);
    return null;
  }
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
  // Throws on a corrupt payload, which rolls the transaction back before anything is overwritten.
  return { id: row.id, log: parseActionLog(row.name) };
}

async function saveLog(tx: Executor, logId: number, log: ActionLog): Promise<void> {
  await tx.update(assets).set({ name: JSON.stringify(log) }).where(eq(assets.id, logId));
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

async function successorAssetId(
  tx: Executor,
  asset: NonNullable<CorporatePlan["positionPatches"][number]["successorAsset"]>,
): Promise<number> {
  await tx.insert(assets).values(asset).onConflictDoNothing();
  const [row] = await tx.select({ id: assets.id }).from(assets).where(eq(assets.symbol, asset.symbol)).limit(1);
  if (!row) throw new Error(`Successor listing ${asset.symbol} could not be created`);
  return row.id;
}

/** Applies the plan and records it in `log`. The caller saves the log. */
async function writePlan(tx: Executor, plan: CorporatePlan, log: ActionLog): Promise<void> {
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
  const created = new Map<string, number>();
  for (const patch of plan.positionPatches) {
    let assetId = patch.assetId;
    if (patch.successorAsset) {
      const symbol = patch.successorAsset.symbol;
      assetId = created.get(symbol) ?? await successorAssetId(tx, patch.successorAsset);
      created.set(symbol, assetId);
    }
    await tx.update(positions).set({
      quantity: patch.quantity,
      startPrice: patch.startPrice,
      assetId,
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
    if (patch.splitRecord) {
      log.appliedSplitsByPosition[key] = [...(log.appliedSplitsByPosition[key] ?? []), patch.splitRecord];
    }
    if (patch.effectiveAt !== null) {
      log.effectiveAtByPosition[key] = Math.max(log.effectiveAtByPosition[key] ?? 0, patch.effectiveAt);
    }
  }
  log.revision += 1;
}

type CommitOptions = {
  /** Stable id (merger map). Already applied: skip. */
  actionId?: string;
  /** Admin submission id. Seen before: no-op. */
  requestId?: string;
  /** Admin edits: the book revision the form was loaded at. */
  expectedRevision?: number;
};

async function commitBuilt(
  build: (holdings: Holding[], listings: Listing[], log: ActionLog) => CorporatePlan,
  options: CommitOptions = {},
): Promise<string | null> {
  const race = await getRace();
  if (race.status !== "running") {
    throw httpError(`Corporate actions can be recorded while the race is running (status: ${race.status})`, 409);
  }
  const summary = await getDb().transaction(async (tx) => {
    const { id, log } = await lockLog(tx);
    if (options.requestId && log.requestIds.includes(options.requestId)) {
      return "Already recorded; the repeated submission was ignored.";
    }
    if (options.actionId && log.appliedActionIds.includes(options.actionId)) return null;
    if (options.expectedRevision !== undefined && options.expectedRevision !== log.revision) {
      throw httpError("Positions changed since this form was loaded. Reload the panel and try again.", 409);
    }
    const { holdings, listings } = await loadBook(tx);
    let plan: CorporatePlan | null;
    try {
      plan = build(holdings, listings, log);
    } catch (error) {
      // A mapped split that Yahoo or an admin already applied: remember the id so it stops retrying.
      if (!(error instanceof AlreadyAppliedError) || !options.actionId) throw error;
      plan = null;
    }
    if (plan) await writePlan(tx, plan, log);
    if (options.actionId) log.appliedActionIds.push(options.actionId);
    if (options.requestId) log.requestIds = [...log.requestIds, options.requestId].slice(-MAX_REQUEST_IDS);
    await saveLog(tx, id, log);
    return plan?.summary ?? null;
  });
  clearQuoteCaches();
  return summary;
}

export async function applyConfiguredMappings(now = new Date()): Promise<string[]> {
  if (mergerMappings.length === 0) return [];
  const race = await getRace();
  if (race.status !== "running") return [];
  // Cheap read first so a fully applied map never opens a write transaction.
  const current = await readActionLog();
  const pending = mergerMappings.filter((mapping) => !current.appliedActionIds.includes(mappingActionId(mapping)));
  const summaries: string[] = [];
  for (const mapping of pending) {
    const actionId = mappingActionId(mapping);
    try {
      const summary = await commitBuilt(
        (holdings, listings, log) => planFromMapping(holdings, listings, mapping, now, log),
        { actionId },
      );
      if (summary) summaries.push(summary);
    } catch (error) {
      if (error instanceof CorporateActionError) {
        console.warn(`merger mapping ${actionId} not applied: ${error.message}`);
        continue;
      }
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
  const result = await getDb().transaction(async (tx) => {
    const { id: logId, log } = await lockLog(tx);
    const { holdings } = await loadBook(tx);
    const applied: { positionId: number; symbol: string; ratio: number }[] = [];
    for (const holding of holdings) {
      if (holding.priceSource !== "yahoo") continue;
      const splits = splitsByTicker.get(holding.sourceId);
      if (!splits || splits.length === 0) continue;
      const key = String(holding.positionId);
      const after = log.splitsAfterByPosition[key] ?? startedAtUnix;
      for (const split of implausibleSplits(splits, after, log.appliedSplitsByPosition[key])) {
        console.error(
          `Ignoring implausible ${split.numerator}:${split.denominator} split for ${holding.symbol} (Yahoo event ${split.id}). Record it by hand if it is real.`,
        );
      }
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
      log.effectiveAtByPosition[key] = Math.max(log.effectiveAtByPosition[key] ?? 0, ...pending.map((split) => split.date));
      applied.push({ positionId: holding.positionId, symbol: holding.symbol, ratio });
    }
    if (applied.length > 0) {
      log.revision += 1;
      await saveLog(tx, logId, log);
    }
    return applied;
  });
  if (result.length > 0) clearQuoteCaches();
  return result;
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
      await saveLog(tx, id, log);
    });
  }
  return applied;
}

export async function reconcileBeforeSnapshot(): Promise<void> {
  // Mapped deals only. The wide Yahoo split history is an admin action so a
  // snapshot cannot turn a rate limit into a field of false delistings.
  await applyConfiguredMappings();
}

/**
 * Runs `write` only if no corporate action committed since `revision` was read,
 * holding the log lock so none can commit while it runs. False means reload and retry.
 */
export async function writeAtActionRevision(
  revision: number,
  write: (tx: Executor) => Promise<void>,
): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const { log } = await lockLog(tx);
    if (log.revision !== revision) return false;
    await write(tx);
    return true;
  });
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

/** `requestId` makes a resubmission a no-op. `effectiveAt` is unix seconds; defaults to now. */
type AdminMeta = { requestId?: string; effectiveAt?: number };

export type AdminCorporateAction =
  | ({ kind: "split"; symbol: string; ratio: number } & AdminMeta)
  | ({ kind: "stock"; symbol: string; acquirerSymbol: string; ratio: number; acquirerName?: string; quoteCurrency?: string } & AdminMeta)
  | ({ kind: "cash"; symbol: string; cashPerShare: number } & AdminMeta)
  | ({ kind: "rename"; symbol: string; toSymbol: string; name?: string } & AdminMeta)
  | {
      kind: "edit";
      positionId: number;
      quantity?: number;
      startPrice?: number;
      allocation?: number;
      requestId?: string;
      expectedRevision?: number;
    }
  | { kind: "sync" };

function checkEffectiveAt(effectiveAt: number, startedAt: Date | null, nowSec: number) {
  if (effectiveAt > nowSec + FUTURE_SLACK_SEC) {
    throw new CorporateActionError("The effective date is in the future. Record the action once it has taken effect.");
  }
  if (startedAt) {
    const raceDay = Math.floor(startedAt.getTime() / 86_400_000) * 86_400;
    if (effectiveAt < raceDay) {
      throw new CorporateActionError("The effective date is before the race started; the start price already reflects it.");
    }
  }
}

export async function executeCorporateAction(action: AdminCorporateAction): Promise<{ summary: string }> {
  const race = await getRace();
  if (race.status !== "running") {
    throw httpError(`Corporate actions can be recorded while the race is running (status: ${race.status})`, 409);
  }
  if (action.kind === "sync") {
    const mapped = await applyConfiguredMappings();
    const splits = await syncWideSplits({ force: true });
    const parts = [
      ...mapped,
      ...splits.map((split) => `Split ${split.symbol} ×${split.ratio} on position ${split.positionId}`),
    ];
    return { summary: parts.length > 0 ? parts.join("; ") : "No mapped deals or unapplied splits." };
  }
  if (action.kind === "edit") {
    const summary = await commitBuilt((holdings) => planEdit(holdings, action), {
      requestId: action.requestId,
      expectedRevision: action.expectedRevision,
    });
    return { summary: summary ?? "Nothing to change." };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const effectiveAt = action.effectiveAt ?? nowSec;
  checkEffectiveAt(effectiveAt, race.startedAt, nowSec);
  const summary = await commitBuilt((holdings, listings, log) => {
    switch (action.kind) {
      case "split":
        return planSplit(holdings, action.symbol, action.ratio, { date: effectiveAt, log });
      case "cash":
        return planCashBuyout(holdings, listings, action.symbol, action.cashPerShare, { effectiveAt });
      case "rename":
        return planRename(holdings, listings, { symbol: action.symbol, toSymbol: action.toSymbol, name: action.name, effectiveAt });
      case "stock":
        return planStockConversion(holdings, listings, {
          symbol: action.symbol,
          acquirerSymbol: action.acquirerSymbol,
          ratio: action.ratio,
          acquirerName: action.acquirerName,
          quoteCurrency: action.quoteCurrency,
          effectiveAt,
        });
    }
  }, { requestId: action.requestId });
  return { summary: summary ?? "Nothing to apply." };
}

export async function listCorporateActionBook(): Promise<{
  status: string;
  /** Send back with edits so a stale form cannot overwrite a newer action. Null if the log is unreadable. */
  revision: number | null;
  logError: string | null;
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
  let revision: number | null = null;
  let logError: string | null = null;
  try {
    revision = (await readActionLog()).revision;
  } catch (error) {
    logError = (error as Error).message;
  }
  const { holdings } = await loadBook(getDb());
  return {
    status: race.status,
    revision,
    logError,
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
