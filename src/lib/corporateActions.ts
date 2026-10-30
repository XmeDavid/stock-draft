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

export type MergerMapping =
  | { from: string; kind: "stock"; acquirer: string; ratio: number; name?: string }
  | { from: string; kind: "cash"; cashPerShare: number }
  | { from: string; kind: "rename"; to: string; name?: string }
  | { from: string; kind: "split"; ratio: number };

export type AppliedSplit = {
  id: string;
  /** Ex-date, or the time an admin recorded the split. Unix seconds. */
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
  /** Last successful wide split lookup, unix milliseconds. */
  wideSyncAt?: number;
};

export type PriceBasis = "live" | "last-snapshot" | "start" | "cash";

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

type QuoteSuccess = { price: number; previousClose?: number };
type QuoteFailure = { error: string };

export function emptyActionLog(): ActionLog {
  return { appliedSplitsByPosition: {}, splitsAfterByPosition: {}, lineageByPosition: {} };
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
      return typeof row.id === "string" && typeof row.date === "number" && typeof row.ratio === "number";
    })
  );
}

export function parseActionLog(raw: string): ActionLog {
  try {
    const value = JSON.parse(raw) as Partial<ActionLog>;
    return {
      appliedSplitsByPosition: isAppliedSplitRecord(value.appliedSplitsByPosition) ? value.appliedSplitsByPosition : {},
      splitsAfterByPosition: isNumberRecord(value.splitsAfterByPosition) ? value.splitsAfterByPosition : {},
      lineageByPosition: isLineageRecord(value.lineageByPosition) ? value.lineageByPosition : {},
      ...(typeof value.wideSyncAt === "number" ? { wideSyncAt: value.wideSyncAt } : {}),
    };
  } catch {
    return emptyActionLog();
  }
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

/** True for ratios Yahoo would report (2:1, 3:2, 1:10, …), not a 1.3% price wiggle. */
export function isCleanSplitRatio(ratio: number): boolean {
  if (!Number.isFinite(ratio) || ratio <= 0) return false;
  if (Math.abs(ratio - 1) < 1e-6) return false;
  for (let denominator = 1; denominator <= 20; denominator++) {
    const numerator = ratio * denominator;
    const rounded = Math.round(numerator);
    if (rounded >= 1 && rounded <= 200 && Math.abs(numerator - rounded) < 1e-4) return true;
  }
  return false;
}

const DUPLICATE_SPLIT_WINDOW_SEC = 10 * 24 * 60 * 60;

/**
 * Yahoo events still missing from the position. An admin split suppresses a
 * Yahoo event with the same ratio inside ten days, so recording a split by
 * hand and then syncing does not apply it twice. Two different ratios still both apply.
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
      const duplicate = (applied ?? []).some((item) =>
        item.id.startsWith("admin:")
        && Math.abs(item.ratio - ratio) < 1e-6
        && Math.abs(item.date - split.date) <= DUPLICATE_SPLIT_WINDOW_SEC
      );
      return !duplicate;
    })
    .sort((a, b) => a.date - b.date || a.id.localeCompare(b.id));
}

export function ratioOfSplits(splits: YahooSplit[]): number {
  return splits.reduce((factor, split) => factor * (split.numerator / split.denominator), 1);
}

export function adminSplitRecord(positionId: number, ratio: number, nowSec: number): AppliedSplit {
  return { id: `admin:${positionId}:${nowSec}:${ratio}`, date: nowSec, ratio };
}

/**
 * A missing quote must not masquerade as a live print at the starting price.
 * Last snapshot wins over the start price so a gained position is not rewound.
 * The start price is only a last resort before any snapshot exists, and it is flagged.
 */
export function resolvePositionQuote(input: {
  live: QuoteSuccess | QuoteFailure | undefined;
  lastSnapshotPrice: number | null;
  startPrice: number;
  priceSource: string;
}): ResolvedQuote {
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
      possibleCorporateAction: true,
      priceBasis: "last-snapshot",
    };
  }
  return {
    price: input.startPrice,
    pricingStatus: "unpriced",
    possibleCorporateAction: true,
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
}): SnapshotValuationRow {
  const quote = resolvePositionQuote({
    live: input.live,
    lastSnapshotPrice: input.lastSnapshotPrice,
    startPrice: input.startPrice,
    priceSource: input.priceSource,
  });
  const valued = valuePosition(input, quote);
  return {
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

export function lastKnownPriceFor(
  snapshots: { playerId: number; breakdown: { assetId: number; price: number }[] }[],
  playerId: number,
  assetIds: number[],
): number | null {
  const ids = new Set(assetIds);
  for (let index = snapshots.length - 1; index >= 0; index--) {
    const snapshot = snapshots[index];
    if (snapshot.playerId !== playerId) continue;
    const row = snapshot.breakdown.find((item) => ids.has(item.assetId) && Number.isFinite(item.price));
    if (row) return row.price;
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
  };
}

export function planSplit(holdings: Holding[], symbol: string, ratio: number): CorporatePlan {
  assertRatio(ratio);
  const matches = holdingsForSymbol(holdings, symbol);
  if (matches.some((holding) => holding.priceSource === "none" || holding.type === "cash" || holding.symbol === "CASH")) {
    throw new CorporateActionError(`${symbol} is cash and cannot be split`);
  }
  return {
    summary: `Split ${matches[0].symbol} ${ratio}-for-1 across ${matches.length} position(s)`,
    assetPatch: null,
    positionPatches: matches.map((holding) => {
      const adjusted = applyRatio(holding.quantity, holding.startPrice, ratio);
      return unchangedPatch(holding, adjusted.quantity, adjusted.startPrice);
    }),
  };
}

export function planCashBuyout(
  holdings: Holding[],
  listings: Listing[],
  symbol: string,
  cashPerShare: number,
): CorporatePlan {
  assertRatio(cashPerShare);
  const matches = holdingsForSymbol(holdings, symbol);
  const listing = requireListing(listings, matches[0].assetId);
  if (listing.priceSource === "none" || listing.symbol === "CASH" || listing.symbol === ACTION_LOG_SYMBOL) {
    throw new CorporateActionError(`${listing.symbol} is already cash`);
  }
  return {
    summary: `Cash buyout of ${listing.symbol} at ${cashPerShare} per share`,
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
      return unchangedPatch(holding, adjusted.quantity, adjusted.startPrice);
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
    now?: Date;
  },
): CorporatePlan {
  assertRatio(input.ratio);
  const from = input.symbol.trim().toUpperCase();
  const acquirerSymbol = input.acquirerSymbol.trim().toUpperCase();
  if (!acquirerSymbol) throw new CorporateActionError("Acquirer symbol is required");
  if (from === acquirerSymbol) {
    throw new CorporateActionError(`Use a split to adjust ${from}; a stock deal needs the acquirer's ticker`);
  }
  const matches = holdingsForSymbol(holdings, from);
  const sourceListing = requireListing(listings, matches[0].assetId);
  if (sourceListing.symbol === ACTION_LOG_SYMBOL) throw new CorporateActionError("That listing cannot be converted");
  const acquirerListing = listings.find((listing) =>
    listing.symbol.toUpperCase() === acquirerSymbol && listing.id !== sourceListing.id
  );
  const nowSec = Math.floor((input.now ?? new Date()).getTime() / 1000);
  // A punctuation fix is the same company, so its split history still belongs to these shares.
  // A real successor has its own history and must not replay splits from before the deal.
  const sameInstrument = tickerKey(from) === tickerKey(acquirerSymbol) && input.ratio === 1;
  const splitsAfter = sameInstrument ? null : nowSec;
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
        unchangedPatch(holding, quantity, startPrice, { splitsAfter })
      ),
    };
  }

  for (const holding of matches) {
    const clash = holdings.find((other) =>
      other.playerId === holding.playerId
      && other.positionId !== holding.positionId
      && (other.assetId === acquirerListing.id || other.symbol.toUpperCase() === acquirerSymbol)
    );
    if (clash) {
      throw new CorporateActionError(
        `${holding.playerName} already holds ${acquirerSymbol}. A player cannot keep two positions in one listing — edit the quantities instead.`
      );
    }
  }

  return {
    summary: `Convert ${from} into existing ${acquirerSymbol} at ${input.ratio} share(s) per share`,
    assetPatch: null,
    positionPatches: adjustedHoldings.map(({ holding, quantity, startPrice }) =>
      unchangedPatch(holding, quantity, startPrice, {
        assetId: acquirerListing.id,
        previousAssetId: holding.assetId,
        splitsAfter,
      })
    ),
  };
}

export function planRename(
  holdings: Holding[],
  listings: Listing[],
  input: { symbol: string; toSymbol: string; name?: string; now?: Date },
): CorporatePlan {
  return planStockConversion(holdings, listings, {
    symbol: input.symbol,
    acquirerSymbol: input.toSymbol,
    ratio: 1,
    acquirerName: input.name,
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
): CorporatePlan {
  switch (mapping.kind) {
    case "split":
      return planSplit(holdings, mapping.from, mapping.ratio);
    case "cash":
      return planCashBuyout(holdings, listings, mapping.from, mapping.cashPerShare);
    case "rename":
      return planRename(holdings, listings, { symbol: mapping.from, toSymbol: mapping.to, name: mapping.name, now });
    case "stock":
      return planStockConversion(holdings, listings, {
        symbol: mapping.from,
        acquirerSymbol: mapping.acquirer,
        ratio: mapping.ratio,
        acquirerName: mapping.name,
        now,
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

export function unpricedHint(symbol: string, mappings: MergerMapping[], quotedSymbol?: string): string {
  const mapped = mappingHint(symbol, mappings);
  if (mapped) return mapped;
  if (quotedSymbol && tickerKey(quotedSymbol) !== tickerKey(symbol)) {
    return `Yahoo identifies this quote as ${quotedSymbol}. Confirm the deal before remapping.`;
  }
  return "No live price. Possible delisting, merger, or rename — last known value is shown until an admin records the action.";
}
