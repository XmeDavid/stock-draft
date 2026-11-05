import type { MergerMapping } from "@/lib/corporateActions";

/**
 * Deals the running race should apply by itself, before the next quote.
 * Leave this empty unless Yahoo will not describe the successor.
 *
 * Ratios are acquirer shares (or cash currency units) per drafted share.
 * Split ratios are new shares per old share (2 means a 2-for-1 split).
 *
 * The admin corporate-action tool records a one-off deal without a deploy.
 * Add it here only when the same adjustment must survive a database reset
 * or be re-applied automatically after a fresh start.
 */
export const mergerMappings: MergerMapping[] = [];
