export function turnFor(order: number[], pickIndex: number): number {
  const n = order.length;
  if (n === 0) throw new Error("Draft order is empty");
  const slot = pickIndex % n;
  const round = Math.floor(pickIndex / n);
  return round % 2 === 0 ? order[slot] : order[n - 1 - slot];
}
