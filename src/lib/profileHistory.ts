export type ProfileHistoryPoint = Record<string, number | string>;

export function withReturnBaseline(
  history: ProfileHistoryPoint[],
  seriesKeys: string[]
): ProfileHistoryPoint[] {
  const baseline: ProfileHistoryPoint = { date: "Start" };
  for (const key of seriesKeys) baseline[key] = 0;
  return [baseline, ...history];
}
