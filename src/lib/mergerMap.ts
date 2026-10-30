import type { MergerMapping } from "@/lib/corporateActions";

/**
 * Deals the running race should apply by itself, before the next quote.
 * Leave this empty unless Yahoo will not describe the successor.
 *
 * Ratios are acquirer shares (or cash currency units) per drafted share.
 * Split ratios are new shares per old share (2 means a 2-for-1 split).
 * `effectiveDate` (YYYY-MM-DD) is when the deal took effect; a split must
 * give its ex-date. Each entry gets a stable id and is applied once —
 * editing an entry gives it a new id, so it would apply again.
 *
 * The admin corporate-action tool records a one-off deal without a deploy.
 * Add it here only when the same adjustment must survive a database reset
 * or be re-applied automatically after a fresh start.
 */
export const mergerMappings: MergerMapping[] = [];
