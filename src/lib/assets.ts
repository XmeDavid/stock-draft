// Allowed values for the free-form String columns on Asset, so the pricing
// layer never sees a type/source it can't handle.
export const TYPES = ["equity", "etf", "gold", "crypto", "cash"];
export const SOURCES = ["yahoo", "coingecko", "none"];
