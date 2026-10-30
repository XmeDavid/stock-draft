import { percentGain, positionValue } from "@/lib/valuation";

/**
 * Sentinel asset row (no position, so it never appears in standings) that
 * stores which split factors and former asset ids have already been applied.
 * Keeping the book in an existing text column avoids a migration on the live race.
 */
export const ACTION_LOG_SYMBOL = "__CORP_ACTIONS__";

export type YahooSplit = {
  /** Yahoo events map key. Stable for the same corporate event. */
  id: string;
  /** Ex-date, unix seconds. */
  date: number;
  numerator: number;
  denominator: number;
};

/**
 * `effectiveDate` (YYYY-MM-DD or ISO) is when the deal took effect. A split
 * needs it: it is the ex-date, part of the mapping's stable id, and what the
 * Yahoo event is matched against.
 */
export type MergerMapping =
  | { from: string; kind: "stock"; acquirer: string; ratio: number; name?: string; effectiveDate?: string }
  | { from: string; kind: "cash"; cashPerShare: number; effectiveDate?: string }
  | { from: string; kind: "rename"; to: string; name?: string; effectiveDate?: string }
  | { from: string; kind: "split"; ratio: number; effectiveDate: string };

export type AppliedSplit = {
  id: string;
  /** Ex-date (Yahoo, mapped, or the date an admin entered). Unix seconds. */
  date: number;
  ratio: number;
};

export type ActionLog = {
  /** Splits already reflected in each position's share count, Yahoo ids and admin entries. */
  appliedSplitsByPosition: Record<string, AppliedSplit[]>;
  /**
   * Unix seconds. Split events at or before this instant belong to the previous
   * ticker and are not replayed onto shares received in a stock deal.
   */
  splitsAfterByPosition: Record<string, number>;
  /** Former asset ids, oldest first, so charts can follow a position onto a shared listing. */
  lineageByPosition: Record<string, number[]>;
  /** Unix seconds when the latest corporate action on each position took effect. */
  effectiveAtByPosition: Record<string, number>;
  /** Stable ids of merger-map entries already applied. Never pruned. */
  appliedActionIds: string[];
  /** Recent admin submission ids, so a double submit is a no-op. */
  requestIds: string[];
  /** Bumped by every write that changes a position or listing. Versions quote caches and snapshots. */
  revision: number;
  /** Last successful wide split lookup, unix milliseconds. */
  wideSyncAt?: number;
};

export const MAX_REQUEST_IDS = 200;

export type PriceBasis = "live" | "last-snapshot" | "start" | "cash";

export type PriceBasisInput = { price: number; quantity?: number };

export type ResolvedQuote = {
  price: number;
  previousClose?: number;
  pricingStatus: "live" | "unpriced";
  possibleCorporateAction: boolean;
  priceBasis: PriceBasis;
};

export type Holding = {
  positionId: number;
  playerId: number;
  playerName: string;
  assetId: number;
  symbol: string;
  name: string;
  type: string;
  priceSource: string;
  sourceId: string;
  quoteCurrency: string;
  quantity: number;
  startPrice: number;
  allocation: number;
  isMvp: boolean;
};

export type Listing = {
  id: number;
  symbol: string;
  name: string;
  type: string;
  priceSource: string;
  sourceId: string;
  quoteCurrency: string;
};

export type PositionPatch = {
  positionId: number;
  quantity: number;
  startPrice: number;
  assetId: number;
  allocation?: number;
  /** Set when the position moves onto a listing someone else already holds. */
  previousAssetId: number | null;
  /** Set when later split lookups must ignore this ticker's pre-deal history. */
  splitsAfter: number | null;
  /** Unix seconds the action took effect, for chart splicing and fallback checks. */
  effectiveAt: number | null;
  /** Recorded against the position so the same split is never applied twice. */
  splitRecord?: AppliedSplit;
  /** Listing to create (or reuse by symbol) and move the position onto. `assetId` is ignored. */
  successorAsset?: Omit<AssetPatch, "assetId">;
};

export type AssetPatch = {
  assetId: number;
  symbol: string;
  name: string;
  type: string;
  priceSource: string;
  sourceId: string;
  quoteCurrency: string;
};

export type CorporatePlan = {
  summary: string;
  positionPatches: PositionPatch[];
  assetPatch: AssetPatch | null;
};

export class CorporateActionError extends Error {}

/** The action is already reflected in the book. Retrying must not apply it again. */
export class AlreadyAppliedError extends CorporateActionError {}

/** The stored log is unreadable. Writers must stop rather than overwrite it with an empty one. */
export class CorruptActionLogError extends Error {}

type QuoteSuccess = { price: number; previousClose?: number };
type QuoteFailure = { error: string; quotedSymbol?: string };

export function emptyActionLog(): ActionLog {
  return {
    appliedSplitsByPosition: {},
    splitsAfterByPosition: {},
    lineageByPosition: {},
    effectiveAtByPosition: {},
    appliedActionIds: [],
    requestIds: [],
    revision: 0,
  };
}

function isNumberRecord(value: unknown): value is Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every((item) => typeof item === "number" && Number.isFinite(item));
}

function isLineageRecord(value: unknown): value is Record<string, number[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every((item) =>
    Array.isArray(item) && item.every((id) => typeof id === "number" && Number.isInteger(id))
  );
}

function isAppliedSplitRecord(value: unknown): value is Record<string, AppliedSplit[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every((item) =>
    Array.isArray(item) && item.every((split) => {
      if (!split || typeof split !== "object") return false;
      const row = split as AppliedSplit;
      return typeof row.id === "string" && Number.isFinite(row.date) && Number.isFinite(row.ratio) && row.ratio > 0;
    })
  );
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Throws `CorruptActionLogError` instead of returning an empty log: an empty
 * log forgets every applied split, so the next sync would apply them again.
 * Fields missing from older logs default; fields present but malformed do not.
 */
export function parseActionLog(raw: string): ActionLog {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new CorruptActionLogError(`Corporate action log is not valid JSON: ${(error as Error).message}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CorruptActionLogError("Corporate action log is not a JSON object");
  }
  const record = value as Record<string, unknown>;
  function field<T>(key: keyof ActionLog, valid: (item: unknown) => item is T, fallback: T): T {
    const item = record[key];
    if (item === undefined) return fallback;
    if (!valid(item)) throw new CorruptActionLogError(`Corporate action log field ${key} is malformed`);
    return item;
  }
  const empty = emptyActionLog();
  const wideSyncAt = field<number | undefined>("wideSyncAt", isFiniteNumber, undefined);
  return {
    appliedSplitsByPosition: field("appliedSplitsByPosition", isAppliedSplitRecord, empty.appliedSplitsByPosition),
    splitsAfterByPosition: field("splitsAfterByPosition", isNumberRecord, empty.splitsAfterByPosition),
    lineageByPosition: field("lineageByPosition", isLineageRecord, empty.lineageByPosition),
    effectiveAtByPosition: field("effectiveAtByPosition", isNumberRecord, empty.effectiveAtByPosition),
    appliedActionIds: field("appliedActionIds", isStringList, empty.appliedActionIds),
    requestIds: field("requestIds", isStringList, empty.requestIds),
    revision: field("revision", isFiniteNumber, empty.revision),
    ...(wideSyncAt === undefined ? {} : { wideSyncAt }),
  };
}

export function tickerKey(symbol: string): string {
  return symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Same letters, different Yahoo punctuation (`BRK.B` and `BRK-B`). */
export function punctuationVariants(symbol: string): string[] {
  const upper = symbol.trim().toUpperCase();
  const variants = new Set<string>();
  if (upper.includes(".")) variants.add(upper.replaceAll(".", "-"));
  if (upper.includes("-")) variants.add(upper.replaceAll("-", "."));
  variants.delete(upper);
  return [...variants];
}

export function splitsFromChart(data: unknown): YahooSplit[] {
  const result = (data as {
    chart?: { result?: Array<{ events?: { splits?: Record<string, unknown> } }> };
  } | null)?.chart?.result?.[0];
  const splits = result?.events?.splits;
  if (!splits || typeof splits !== "object") return [];
  return Object.entries(splits).flatMap(([id, raw]) => {
    if (!raw || typeof raw !== "object") return [];
    const row = raw as { date?: unknown; numerator?: unknown; denominator?: unknown };
    const numerator = Number(row.numerator);
    const denominator = Number(row.denominator);
    const date = typeof row.date === "number" ? row.date : Number(id);
    if (!(numerator > 0) || !(denominator > 0) || !Number.isFinite(date)) return [];
    return [{ id, date, numerator, denominator }];
  });
}

/** Product of split ratios whose ex-date is strictly after `afterUnix`. */
export function cumulativeSplitFactor(splits: YahooSplit[], afterUnix: number): number {
  return splits.reduce((factor, split) => {
    if (split.date <= afterUnix) return factor;
    if (!(split.numerator > 0) || !(split.denominator > 0)) return factor;
    return factor * (split.numerator / split.denominator);
  }, 1);
}

/** Largest split either way (1000-for-1 or 1-for-1000). Anything beyond is a data error. */
export const MAX_SPLIT_FACTOR = 1000;

/**
 * True for ratios Yahoo would report (2:1, 3:2, 1:10, 1:30, …), not a 1.3% price wiggle.
 * The larger side is tested so a 1-for-30 reverse split passes as readily as a 30-for-1.
 */
export function isCleanSplitRatio(ratio: number): boolean {
  if (!Number.isFinite(ratio) || ratio <= 0) return false;
  if (Math.abs(ratio - 1) < 1e-6) return false;
  const factor = ratio >= 1 ? ratio : 1 / ratio;
  if (factor > MAX_SPLIT_FACTOR) return false;
  for (let denominator = 1; denominator <= 20; denominator++) {
    const numerator = factor * denominator;
    if (Math.abs(numerator - Math.round(numerator)) < 1e-4) return true;
  }
  return false;
}

/** Admin and mapped split ratios: positive, finite, not 1, and within the sane range. */
export function assertSplitRatio(ratio: number) {
  assertRatio(ratio);
  if (Math.abs(ratio - 1) < 1e-9) throw new CorporateActionError("A split ratio of 1 changes nothing");
  const factor = ratio >= 1 ? ratio : 1 / ratio;
  if (factor > MAX_SPLIT_FACTOR) {
    throw new CorporateActionError(`Split ratio ${ratio} is outside 1-for-${MAX_SPLIT_FACTOR} to ${MAX_SPLIT_FACTOR}-for-1`);
  }
}

const DUPLICATE_SPLIT_WINDOW_SEC = 10 * 24 * 60 * 60;

/** An applied split with the same ratio within ten days of `date`, from any source. */
export function duplicateSplit(
  applied: AppliedSplit[] | undefined,
  ratio: number,
  date: number,
  include: (split: AppliedSplit) => boolean = () => true,
): AppliedSplit | undefined {
  return (applied ?? []).find((item) =>
    include(item)
    && Math.abs(item.ratio - ratio) < 1e-6
    && Math.abs(item.date - date) <= DUPLICATE_SPLIT_WINDOW_SEC
  );
}

function recordedByHand(split: AppliedSplit): boolean {
  return split.id.startsWith("admin:") || split.id.startsWith("map:");
}

/**
 * Yahoo events still missing from the position. An admin or mapped split
 * suppresses a Yahoo event with the same ratio within ten days of its ex-date,
 * so recording a split by hand and then syncing does not apply it twice.
 * Two different ratios still both apply.
 */
export function unappliedSplits(
  splits: YahooSplit[],
  afterUnix: number,
  applied: AppliedSplit[] | undefined,
): YahooSplit[] {
  const seen = new Set((applied ?? []).map((split) => split.id));
  return splits
    .filter((split) => {
      const ratio = split.numerator / split.denominator;
      if (split.date <= afterUnix || seen.has(split.id) || !isCleanSplitRatio(ratio)) return false;
      return !duplicateSplit(applied, ratio, split.date, recordedByHand);
    })
    .sort((a, b) => a.date - b.date || a.id.localeCompare(b.id));
}

/** Yahoo events in the window whose ratio is not a plausible split. Logged, never applied. */
export function implausibleSplits(
  splits: YahooSplit[],
  afterUnix: number,
  applied: AppliedSplit[] | undefined,
): YahooSplit[] {
  const seen = new Set((applied ?? []).map((split) => split.id));
  return splits.filter((split) =>
    split.date > afterUnix && !seen.has(split.id) && !isCleanSplitRatio(split.numerator / split.denominator)
  );
}

export function ratioOfSplits(splits: YahooSplit[]): number {
  return splits.reduce((factor, split) => factor * (split.numerator / split.denominator), 1);
}

function isoDay(unixSec: number): string {
  return new Date(unixSec * 1000).toISOString().slice(0, 10);
}

/** Same ticker, ex-date and ratio give the same id, so a resubmitted split is recognised. */
export function adminSplitRecord(symbol: string, ratio: number, dateSec: number): AppliedSplit {
  return { id: `admin:${tickerKey(symbol)}:${isoDay(dateSec)}:${ratio}`, date: dateSec, ratio };
}

/** Parses YYYY-MM-DD (UTC midnight) or a full ISO timestamp into unix seconds. */
export function parseEffectiveDate(value: string): number {
  const text = value.trim();
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(text) ? Date.parse(`${text}T00:00:00Z`) : Date.parse(text);
  if (!Number.isFinite(ms)) throw new CorporateActionError(`Effective date "${value}" is not a date`);
  return Math.floor(ms / 1000);
}

/** Deterministic id for a merger-map entry. Editing the entry gives it a new id. */
export function mappingActionId(mapping: MergerMapping): string {
  const from = tickerKey(mapping.from);
  const date = mapping.effectiveDate?.trim() ?? "";
  switch (mapping.kind) {
    case "split":
      return `map:split:${from}:${date}:${mapping.ratio}`;
    case "cash":
      return `map:cash:${from}:${date}:${mapping.cashPerShare}`;
    case "rename":
      return `map:rename:${from}:${date}:${tickerKey(mapping.to)}`;
    case "stock":
      return `map:stock:${from}:${date}:${tickerKey(mapping.acquirer)}:${mapping.ratio}`;
  }
}

/** Successor listing for a converted pick whose player already holds the acquirer. */
export function successorSymbol(acquirerSymbol: string, fromSymbol: string): string {
  return `${acquirerSymbol.trim().toUpperCase()}~${fromSymbol.trim().toUpperCase()}`;
}

const DELISTING_ERROR = /delisted|no data found|not found|HTTP 404/i;

/**
 * Real evidence that a ticker changed hands, not a rate limit or timeout:
 * Yahoo answered for another symbol, or reported the ticker as gone.
 */
export function quoteSuggestsCorporateAction(live: QuoteSuccess | QuoteFailure | undefined): boolean {
  if (!live || "price" in live) return false;
  return Boolean(live.quotedSymbol) || DELISTING_ERROR.test(live.error);
}

/**
 * A missing quote must not masquerade as a live print at the starting price.
 * Last snapshot wins over the start price so a gained position is not rewound.
 * The start price is only a last resort before any snapshot exists.
 * Either way the quote is unpriced; it is only called a possible corporate
 * action when there is evidence (a mapping, a delisting, a different symbol).
 */
export function resolvePositionQuote(input: {
  live: QuoteSuccess | QuoteFailure | undefined;
  lastSnapshotPrice: number | null;
  startPrice: number;
  priceSource: string;
  /** Extra evidence, e.g. a merger-map entry. Quote errors are checked here too. */
  corporateActionSignal?: boolean;
}): ResolvedQuote {
  const possibleCorporateAction = Boolean(input.corporateActionSignal) || quoteSuggestsCorporateAction(input.live);
  if (input.priceSource === "none") {
    return { price: 1, pricingStatus: "live", possibleCorporateAction: false, priceBasis: "cash" };
  }
  if (input.live && "price" in input.live && Number.isFinite(input.live.price)) {
    return {
      price: input.live.price,
      ...(input.live.previousClose === undefined ? {} : { previousClose: input.live.previousClose }),
      pricingStatus: "live",
      possibleCorporateAction: false,
      priceBasis: "live",
    };
  }
  if (input.lastSnapshotPrice !== null && Number.isFinite(input.lastSnapshotPrice)) {
    return {
      price: input.lastSnapshotPrice,
      pricingStatus: "unpriced",
      possibleCorporateAction,
      priceBasis: "last-snapshot",
    };
  }
  return {
    price: input.startPrice,
    pricingStatus: "unpriced",
    possibleCorporateAction,
    priceBasis: "start",
  };
}

export function valuePosition(
  input: { quantity: number; allocation: number; isMvp: boolean; startPrice: number; type: string },
  quote: ResolvedQuote,
) {
  const value = positionValue(input.quantity, quote.price, input.allocation, input.isMvp);
  return {
    value,
    marketGainPct: input.startPrice > 0 ? percentGain(quote.price, input.startPrice) : 0,
    gainPct: input.allocation > 0 ? percentGain(value, input.allocation) : 0,
    todayGainPct: quote.previousClose && quote.previousClose > 0
      ? percentGain(quote.price, quote.previousClose)
      : input.type === "cash" || quote.priceBasis === "cash"
        ? 0
        : null,
  };
}

export type SnapshotValuationRow = {
  /** Lets later fallbacks find this pick even after it moves to another listing. */
  positionId?: number;
  assetId: number;
  symbol: string;
  quantity: number;
  price: number;
  value: number;
  allocation: number;
  isMvp: boolean;
  pricingStatus: ResolvedQuote["pricingStatus"];
  possibleCorporateAction: boolean;
  priceBasis: PriceBasis;
};

export function buildSnapshotRow(input: {
  positionId?: number;
  assetId: number;
  symbol: string;
  quantity: number;
  allocation: number;
  isMvp: boolean;
  startPrice: number;
  priceSource: string;
  type: string;
  live: QuoteSuccess | QuoteFailure | undefined;
  lastSnapshotPrice: number | null;
  corporateActionSignal?: boolean;
}): SnapshotValuationRow {
  const quote = resolvePositionQuote({
    live: input.live,
    lastSnapshotPrice: input.lastSnapshotPrice,
    startPrice: input.startPrice,
    priceSource: input.priceSource,
    corporateActionSignal: input.corporateActionSignal,
  });
  const valued = valuePosition(input, quote);
  return {
    ...(input.positionId === undefined ? {} : { positionId: input.positionId }),
    assetId: input.assetId,
    symbol: input.symbol,
    quantity: input.quantity,
    price: quote.price,
    value: valued.value,
    allocation: input.allocation,
    isMvp: input.isMvp,
    pricingStatus: quote.pricingStatus,
    possibleCorporateAction: quote.possibleCorporateAction,
    priceBasis: quote.priceBasis,
  };
}

export function historicalAssetIds(assetId: number, lineage: number[] | undefined): number[] {
  return [...new Set([assetId, ...(lineage ?? [])])];
}

export function findBreakdownRow<T extends { assetId: number }>(rows: T[], assetIds: number[]): T | undefined {
  const ids = new Set(assetIds);
  return rows.find((row) => ids.has(row.assetId));
}

export type SnapshotHistory = {
  playerId: number;
  capturedAt?: Date;
  breakdown: { positionId?: number; assetId: number; price: number; quantity?: number }[];
};

/**
 * Splits and stock deals preserve price × quantity, so an old print is restated
 * in today's share count: old price × old quantity / current quantity.
 */
export function normalizedFallbackPrice(row: PriceBasisInput, currentQuantity: number): number | null {
  if (!Number.isFinite(row.price)) return null;
  if (typeof row.quantity !== "number" || !(row.quantity > 0) || !(currentQuantity > 0)) return null;
  return (row.price * row.quantity) / currentQuantity;
}

/**
 * The last snapshot price for one position, in its current share units. Rows
 * tagged with a position id match only that position; older rows match by asset
 * lineage. A row with no share count is trusted only if it postdates the last
 * corporate action on the position, because it cannot be restated.
 */
export function lastKnownPriceFor(
  snapshots: SnapshotHistory[],
  position: { playerId: number; positionId: number; assetIds: number[]; quantity: number; effectiveAt?: number },
): number | null {
  const ids = new Set(position.assetIds);
  for (let index = snapshots.length - 1; index >= 0; index--) {
    const snapshot = snapshots[index];
    if (snapshot.playerId !== position.playerId) continue;
    const row = snapshot.breakdown.find((item) =>
      Number.isFinite(item.price)
      && (item.positionId === undefined ? ids.has(item.assetId) : item.positionId === position.positionId)
    );
    if (!row) continue;
    const scaled = normalizedFallbackPrice(row, position.quantity);
    if (scaled !== null) return scaled;
    const capturedSec = snapshot.capturedAt ? snapshot.capturedAt.getTime() / 1000 : undefined;
    if (position.effectiveAt === undefined || (capturedSec !== undefined && capturedSec >= position.effectiveAt)) {
      return row.price;
    }
    return null;
  }
  return null;
}

/** Scale shares and the per-share cost by the same ratio so allocation stays the cost basis. */
export function applyRatio(quantity: number, startPrice: number, ratio: number): { quantity: number; startPrice: number } {
  assertRatio(ratio);
  return { quantity: quantity * ratio, startPrice: startPrice / ratio };
}

function assertRatio(ratio: number) {
  if (!(ratio > 0) || !Number.isFinite(ratio)) {
    throw new CorporateActionError("Ratio must be a positive number");
  }
}

function holdingsForSymbol(holdings: Holding[], symbol: string): Holding[] {
  const key = symbol.trim().toUpperCase();
  const matches = holdings.filter((holding) => holding.symbol.toUpperCase() === key);
  if (matches.length === 0) throw new CorporateActionError(`No drafted position uses ${key}`);
  const assetIds = new Set(matches.map((holding) => holding.assetId));
  if (assetIds.size !== 1) {
    throw new CorporateActionError(`${key} is split across more than one listing`);
  }
  return matches;
}

/** A split follows the shares, so successor listings priced off the same Yahoo ticker split too. */
function holdingsForSplit(holdings: Holding[], symbol: string): Holding[] {
  const key = symbol.trim().toUpperCase();
  const matches = holdings.filter((holding) =>
    holding.symbol.toUpperCase() === key
    || (holding.priceSource === "yahoo" && holding.sourceId.toUpperCase() === key)
  );
  if (matches.length === 0) throw new CorporateActionError(`No drafted position uses ${key}`);
  return matches;
}

function isCashListing(listing: Pick<Listing, "symbol" | "type" | "priceSource">): boolean {
  return listing.priceSource === "none"
    || listing.type === "cash"
    || listing.type === "system"
    || listing.symbol === "CASH"
    || listing.symbol === ACTION_LOG_SYMBOL;
}

/** Other held listings quoted off the same Yahoo ticker (successor rows) need their own entry. */
function siblingNote(holdings: Holding[], listing: Listing): string {
  if (listing.priceSource !== "yahoo" || !listing.sourceId) return "";
  const siblings = [...new Set(holdings
    .filter((holding) => holding.assetId !== listing.id && holding.priceSource === "yahoo" && holding.sourceId === listing.sourceId)
    .map((holding) => holding.symbol))];
  return siblings.length > 0 ? `. Record the same action for ${siblings.join(", ")} too` : "";
}

function requireListing(listings: Listing[], assetId: number): Listing {
  const listing = listings.find((item) => item.id === assetId);
  if (!listing) throw new CorporateActionError(`Listing ${assetId} was not found`);
  return listing;
}

function unchangedPatch(holding: Holding, quantity: number, startPrice: number, extra: Partial<PositionPatch> = {}): PositionPatch {
  return {
    positionId: holding.positionId,
    quantity,
    startPrice,
    assetId: extra.assetId ?? holding.assetId,
    previousAssetId: extra.previousAssetId ?? null,
    splitsAfter: extra.splitsAfter ?? null,
    effectiveAt: extra.effectiveAt ?? null,
    ...(extra.splitRecord ? { splitRecord: extra.splitRecord } : {}),
    ...(extra.successorAsset ? { successorAsset: extra.successorAsset } : {}),
  };
}

function nowSeconds(now?: Date): number {
  return Math.floor((now ?? new Date()).getTime() / 1000);
}

/**
 * Splits every position on the ticker, except positions that already reflect
 * the same split (any source, same ratio, ex-date within ten days) and shares
 * received in a deal after the ex-date. Throws `AlreadyAppliedError` if no
 * position is left, so a manual entry cannot double a Yahoo or mapped split.
 */
export function planSplit(
  holdings: Holding[],
  symbol: string,
  ratio: number,
  options: {
    /** Ex-date, unix seconds. Defaults to now. */
    date?: number;
    /** Overrides the admin record, e.g. a merger-map id. */
    record?: AppliedSplit;
    log?: Pick<ActionLog, "appliedSplitsByPosition" | "splitsAfterByPosition">;
  } = {},
): CorporatePlan {
  assertSplitRatio(ratio);
  const matches = holdingsForSplit(holdings, symbol);
  if (matches.some((holding) => holding.priceSource === "none" || holding.type === "cash" || holding.symbol === "CASH")) {
    throw new CorporateActionError(`${symbol} is cash and cannot be split`);
  }
  const date = options.record?.date ?? options.date ?? nowSeconds();
  const record = options.record ?? adminSplitRecord(symbol, ratio, date);
  const applicable = matches.filter((holding) => {
    const key = String(holding.positionId);
    const after = options.log?.splitsAfterByPosition[key];
    if (after !== undefined && date <= after) return false;
    const applied = options.log?.appliedSplitsByPosition[key];
    return !applied?.some((split) => split.id === record.id) && !duplicateSplit(applied, ratio, date);
  });
  const label = symbol.trim().toUpperCase();
  if (applicable.length === 0) {
    throw new AlreadyAppliedError(
      `The ${ratio}-for-1 split of ${label} on ${isoDay(date)} is already reflected in every position`,
    );
  }
  const skipped = matches.length - applicable.length;
  return {
    summary: `Split ${label} ${ratio}-for-1 effective ${isoDay(date)} across ${applicable.length} position(s)`
      + (skipped > 0 ? `; ${skipped} position(s) already reflected it` : ""),
    assetPatch: null,
    positionPatches: applicable.map((holding) => {
      const adjusted = applyRatio(holding.quantity, holding.startPrice, ratio);
      return unchangedPatch(holding, adjusted.quantity, adjusted.startPrice, { effectiveAt: date, splitRecord: record });
    }),
  };
}

export function planCashBuyout(
  holdings: Holding[],
  listings: Listing[],
  symbol: string,
  cashPerShare: number,
  options: { effectiveAt?: number } = {},
): CorporatePlan {
  assertRatio(cashPerShare);
  const matches = holdingsForSymbol(holdings, symbol);
  const listing = requireListing(listings, matches[0].assetId);
  if (isCashListing(listing)) {
    throw new CorporateActionError(`${listing.symbol} is already cash`);
  }
  const effectiveAt = options.effectiveAt ?? nowSeconds();
  return {
    summary: `Cash buyout of ${listing.symbol} at ${cashPerShare} per share${siblingNote(holdings, listing)}`,
    assetPatch: {
      assetId: listing.id,
      symbol: listing.symbol,
      name: listing.name.includes("(cash buyout)") ? listing.name : `${listing.name} (cash buyout)`,
      type: "cash",
      priceSource: "none",
      sourceId: "",
      quoteCurrency: listing.quoteCurrency,
    },
    positionPatches: matches.map((holding) => {
      const adjusted = applyRatio(holding.quantity, holding.startPrice, cashPerShare);
      return unchangedPatch(holding, adjusted.quantity, adjusted.startPrice, { effectiveAt });
    }),
  };
}

export function planStockConversion(
  holdings: Holding[],
  listings: Listing[],
  input: {
    symbol: string;
    acquirerSymbol: string;
    ratio: number;
    acquirerName?: string;
    quoteCurrency?: string;
    /** When the deal took effect, unix seconds. Defaults to `now`. */
    effectiveAt?: number;
    now?: Date;
  },
): CorporatePlan {
  assertRatio(input.ratio);
  const from = input.symbol.trim().toUpperCase();
  const acquirerSymbol = input.acquirerSymbol.trim().toUpperCase();
  if (!acquirerSymbol) throw new CorporateActionError("Acquirer symbol is required");
  if (acquirerSymbol === "CASH" || acquirerSymbol === ACTION_LOG_SYMBOL) {
    throw new CorporateActionError(`A stock deal cannot convert into ${acquirerSymbol}; record a cash buyout instead`);
  }
  if (from === acquirerSymbol) {
    throw new CorporateActionError(`Use a split to adjust ${from}; a stock deal needs the acquirer's ticker`);
  }
  const matches = holdingsForSymbol(holdings, from);
  const sourceListing = requireListing(listings, matches[0].assetId);
  if (sourceListing.symbol === ACTION_LOG_SYMBOL || sourceListing.symbol === "CASH") {
    throw new CorporateActionError("That listing cannot be converted");
  }
  const acquirerListing = listings.find((listing) =>
    listing.symbol.toUpperCase() === acquirerSymbol && listing.id !== sourceListing.id
  );
  if (acquirerListing && isCashListing(acquirerListing)) {
    throw new CorporateActionError(`${acquirerSymbol} is a cash listing; a stock deal must convert into shares`);
  }
  const effectiveAt = input.effectiveAt ?? nowSeconds(input.now);
  // A punctuation fix is the same company, so its split history still belongs to these shares.
  // A real successor has its own history and must not replay splits from before the deal.
  const sameInstrument = tickerKey(from) === tickerKey(acquirerSymbol) && input.ratio === 1;
  const splitsAfter = sameInstrument ? null : effectiveAt;
  const adjustedHoldings = matches.map((holding) => {
    const adjusted = applyRatio(holding.quantity, holding.startPrice, input.ratio);
    return { holding, ...adjusted };
  });

  if (!acquirerListing) {
    const name = input.acquirerName?.trim() || sourceListing.name;
    const quoteCurrency = input.quoteCurrency?.trim().toUpperCase() || sourceListing.quoteCurrency;
    return {
      summary: `Convert ${from} into ${acquirerSymbol} at ${input.ratio} share(s) per share`,
      assetPatch: {
        assetId: sourceListing.id,
        symbol: acquirerSymbol,
        name,
        type: sourceListing.type === "cash" ? "equity" : sourceListing.type,
        priceSource: "yahoo",
        sourceId: acquirerSymbol,
        quoteCurrency,
      },
      positionPatches: adjustedHoldings.map(({ holding, quantity, startPrice }) =>
        unchangedPatch(holding, quantity, startPrice, { splitsAfter, effectiveAt })
      ),
    };
  }

  // positions_player_asset_unique allows one position per listing, so a player
  // who already holds the acquirer gets a successor row quoted off the same
  // ticker. Each pick keeps its own allocation, MVP flag and cost basis.
  const successor = successorSymbol(acquirerSymbol, from);
  const successorListing = listings.find((listing) => listing.symbol.toUpperCase() === successor);
  let separate = 0;
  const positionPatches = adjustedHoldings.map(({ holding, quantity, startPrice }) => {
    const base = { previousAssetId: holding.assetId, splitsAfter, effectiveAt };
    const holdsAcquirer = holdings.some((other) =>
      other.playerId === holding.playerId
      && other.positionId !== holding.positionId
      && other.assetId === acquirerListing.id
    );
    if (!holdsAcquirer) return unchangedPatch(holding, quantity, startPrice, { ...base, assetId: acquirerListing.id });
    if (successorListing && holdings.some((other) => other.playerId === holding.playerId && other.assetId === successorListing.id)) {
      throw new CorporateActionError(`${holding.playerName} already holds ${successor}`);
    }
    separate++;
    return unchangedPatch(holding, quantity, startPrice, successorListing
      ? { ...base, assetId: successorListing.id }
      : {
          ...base,
          successorAsset: {
            symbol: successor,
            name: acquirerListing.name,
            type: acquirerListing.type,
            priceSource: acquirerListing.priceSource,
            sourceId: acquirerListing.sourceId,
            quoteCurrency: acquirerListing.quoteCurrency,
          },
        });
  });

  return {
    summary: `Convert ${from} into existing ${acquirerSymbol} at ${input.ratio} share(s) per share`
      + (separate > 0 ? `; ${separate} pick(s) whose player already held ${acquirerSymbol} moved to ${successor}` : ""),
    assetPatch: null,
    positionPatches,
  };
}

export function planRename(
  holdings: Holding[],
  listings: Listing[],
  input: { symbol: string; toSymbol: string; name?: string; effectiveAt?: number; now?: Date },
): CorporatePlan {
  return planStockConversion(holdings, listings, {
    symbol: input.symbol,
    acquirerSymbol: input.toSymbol,
    ratio: 1,
    acquirerName: input.name,
    effectiveAt: input.effectiveAt,
    now: input.now,
  });
}

export function planEdit(
  holdings: Holding[],
  input: { positionId: number; quantity?: number; startPrice?: number; allocation?: number },
): CorporatePlan {
  const holding = holdings.find((item) => item.positionId === input.positionId);
  if (!holding) throw new CorporateActionError("Position not found");
  const quantity = input.quantity ?? holding.quantity;
  const startPrice = input.startPrice ?? holding.startPrice;
  const allocation = input.allocation ?? holding.allocation;
  for (const [label, value] of [["quantity", quantity], ["start price", startPrice], ["allocation", allocation]] as const) {
    if (!(value > 0) || !Number.isFinite(value)) {
      throw new CorporateActionError(`${label} must be a positive number`);
    }
  }
  if (quantity === holding.quantity && startPrice === holding.startPrice && allocation === holding.allocation) {
    throw new CorporateActionError("Nothing to change");
  }
  return {
    summary: `Edit ${holding.symbol} for ${holding.playerName}`,
    assetPatch: null,
    positionPatches: [{
      ...unchangedPatch(holding, quantity, startPrice),
      allocation,
    }],
  };
}

export function planFromMapping(
  holdings: Holding[],
  listings: Listing[],
  mapping: MergerMapping,
  now = new Date(),
  log?: Pick<ActionLog, "appliedSplitsByPosition" | "splitsAfterByPosition">,
): CorporatePlan {
  const effectiveAt = mapping.effectiveDate ? parseEffectiveDate(mapping.effectiveDate) : nowSeconds(now);
  switch (mapping.kind) {
    case "split":
      if (!mapping.effectiveDate) throw new CorporateActionError(`Mapped split of ${mapping.from} needs an effectiveDate`);
      return planSplit(holdings, mapping.from, mapping.ratio, {
        record: { id: mappingActionId(mapping), date: effectiveAt, ratio: mapping.ratio },
        log,
      });
    case "cash":
      return planCashBuyout(holdings, listings, mapping.from, mapping.cashPerShare, { effectiveAt });
    case "rename":
      return planRename(holdings, listings, { symbol: mapping.from, toSymbol: mapping.to, name: mapping.name, effectiveAt });
    case "stock":
      return planStockConversion(holdings, listings, {
        symbol: mapping.from,
        acquirerSymbol: mapping.acquirer,
        ratio: mapping.ratio,
        acquirerName: mapping.name,
        effectiveAt,
      });
  }
}

export function mappingHint(symbol: string, mappings: MergerMapping[]): string | null {
  const mapping = mappings.find((item) => item.from.toUpperCase() === symbol.toUpperCase());
  if (!mapping) return null;
  switch (mapping.kind) {
    case "cash":
      return `Mapped cash buyout at ${mapping.cashPerShare} per share`;
    case "stock":
      return `Mapped stock deal: ${mapping.ratio} ${mapping.acquirer} per share`;
    case "rename":
      return `Mapped rename to ${mapping.to}`;
    case "split":
      return `Mapped split ratio ${mapping.ratio}`;
  }
}

/**
 * `quotedSymbol` is set only when Yahoo answered for a different instrument.
 * Without that or a mapping, `flagged` says whether the failure itself looked
 * like a delisting; otherwise it is a plain quote outage.
 */
export function unpricedHint(symbol: string, mappings: MergerMapping[], quotedSymbol?: string, flagged = true): string {
  const mapped = mappingHint(symbol, mappings);
  if (mapped) return mapped;
  if (quotedSymbol) {
    return `Yahoo answered for ${quotedSymbol}, not ${symbol}. Confirm the deal before remapping; last known value is shown.`;
  }
  if (!flagged) return "Quote unavailable right now. The last known value is shown until the price feed recovers.";
  return "No live price. Possible delisting, merger, or rename — last known value is shown until an admin records the action.";
}
