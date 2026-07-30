// Allowed values for the free-form String columns on Asset. Enforced by both
// the create (POST) and update (PUT) admin routes so the pricing layer never
// sees a type/source it can't handle.
export const TYPES = ["equity", "etf", "gold", "crypto", "cash"];
export const SOURCES = ["yahoo", "coingecko", "none"];
