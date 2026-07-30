export function computeQuantity(allocation: number, price: number): number {
  if (price <= 0) throw new Error(`Invalid price: ${price}`);
  return allocation / price;
}

export function portfolioValue(
  positions: { quantity: number; price: number }[]
): number {
  return positions.reduce((sum, p) => sum + p.quantity * p.price, 0);
}

export function percentGain(current: number, starting: number): number {
  return ((current - starting) / starting) * 100;
}
