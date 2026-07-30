export function computeQuantity(allocation: number, price: number): number {
  if (price <= 0) throw new Error(`Invalid price: ${price}`);
  return allocation / price;
}

export function portfolioValue(
  positions: { quantity: number; price: number; allocation?: number; isMvp?: boolean }[]
): number {
  return positions.reduce(
    (sum, p) => sum + positionValue(p.quantity, p.price, p.allocation, p.isMvp),
    0
  );
}

export function percentGain(current: number, starting: number): number {
  return ((current - starting) / starting) * 100;
}

/**
 * An MVP keeps its original allocation but scores twice its profit or loss.
 * The position is floored at zero so neither it nor the portfolio can create
 * debt when the underlying falls by more than 50%.
 */
export function positionValue(
  quantity: number,
  price: number,
  allocation?: number,
  isMvp = false
): number {
  const marketValue = quantity * price;
  if (!isMvp || allocation === undefined) return marketValue;
  return Math.max(0, allocation + 2 * (marketValue - allocation));
}
