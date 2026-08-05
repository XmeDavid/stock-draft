export type ProfileHistoryPoint = Record<string, number | string>;

function withBaseline(
  history: ProfileHistoryPoint[],
  seriesKeys: string[],
  value: number
): ProfileHistoryPoint[] {
  const baseline: ProfileHistoryPoint = { date: "Start" };
  for (const key of seriesKeys) baseline[key] = value;
  return [baseline, ...history];
}

export function withReturnBaseline(
  history: ProfileHistoryPoint[],
  seriesKeys: string[]
): ProfileHistoryPoint[] {
  return withBaseline(history, seriesKeys, 0);
}

export function withPortfolioBaseline(
  history: ProfileHistoryPoint[],
  playerIds: string[],
  startingCapital: number
): ProfileHistoryPoint[] {
  return withBaseline(history, playerIds, startingCapital);
}
