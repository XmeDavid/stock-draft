export type SnapshotPoint = {
  playerId: number;
  date: Date;
  totalValue: number;
};

export type MatchupPlayer = { id: number; name: string };

export type WeeklyMatchup = {
  week: number;
  playerA: MatchupPlayer;
  playerB: MatchupPlayer;
  returnA: number | null;
  returnB: number | null;
  winnerId: number | null;
  complete: boolean;
};

export function ranksForValues(values: { playerId: number; value: number }[]): Map<number, number> {
  const sorted = [...values].sort((a, b) => b.value - a.value || a.playerId - b.playerId);
  return new Map(sorted.map((row, index) => [row.playerId, index + 1]));
}

export function daysLed(points: SnapshotPoint[]): Map<number, number> {
  const dates = new Map<string, SnapshotPoint[]>();
  for (const point of points) {
    const key = point.date.toISOString().slice(0, 10);
    const rows = dates.get(key) ?? [];
    rows.push(point);
    dates.set(key, rows);
  }

  const result = new Map<number, number>();
  for (const rows of dates.values()) {
    const best = Math.max(...rows.map((row) => row.totalValue));
    for (const row of rows) {
      if (Math.abs(row.totalValue - best) < 0.005) {
        result.set(row.playerId, (result.get(row.playerId) ?? 0) + 1);
      }
    }
  }
  return result;
}

/** Circle-method round-robin pairings. An odd roster receives one bye. */
export function pairingsForWeek(players: MatchupPlayer[], week: number): [MatchupPlayer, MatchupPlayer][] {
  if (players.length < 2) return [];
  const roster: (MatchupPlayer | null)[] = [...players].sort((a, b) => a.id - b.id);
  if (roster.length % 2 === 1) roster.push(null);

  const fixed = roster[0];
  const rotating = roster.slice(1);
  const rounds = roster.length - 1;
  const rotation = ((week - 1) % rounds + rounds) % rounds;
  const shifted = rotation === 0
    ? rotating
    : [...rotating.slice(-rotation), ...rotating.slice(0, -rotation)];
  const arranged = [fixed, ...shifted];
  const pairs: [MatchupPlayer, MatchupPlayer][] = [];
  for (let i = 0; i < arranged.length / 2; i++) {
    const a = arranged[i];
    const b = arranged[arranged.length - 1 - i];
    if (a && b) pairs.push([a, b]);
  }
  return pairs;
}

export function buildWeeklyMatchups(
  players: MatchupPlayer[],
  points: SnapshotPoint[],
  startedAt: Date,
  through: Date
): WeeklyMatchup[] {
  const seasonStart = new Date(`${startedAt.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const elapsed = Math.max(0, through.getTime() - seasonStart.getTime());
  const currentWeek = Math.floor(elapsed / (7 * 86_400_000)) + 1;
  const byPlayer = new Map<number, SnapshotPoint[]>();
  for (const point of points) {
    const rows = byPlayer.get(point.playerId) ?? [];
    rows.push(point);
    byPlayer.set(point.playerId, rows);
  }
  for (const rows of byPlayer.values()) rows.sort((a, b) => a.date.getTime() - b.date.getTime());

  const matchups: WeeklyMatchup[] = [];
  for (let week = 1; week <= currentWeek; week++) {
    const start = seasonStart.getTime() + (week - 1) * 7 * 86_400_000;
    const end = start + 7 * 86_400_000;
    const complete = through.getTime() >= end;
    for (const [playerA, playerB] of pairingsForWeek(players, week)) {
      const returnFor = (playerId: number) => {
        const rows = (byPlayer.get(playerId) ?? []).filter((point) => {
          const time = point.date.getTime();
          return time >= start && time < end;
        });
        if (rows.length < 2) return null;
        return ((rows.at(-1)!.totalValue - rows[0].totalValue) / rows[0].totalValue) * 100;
      };
      const returnA = returnFor(playerA.id);
      const returnB = returnFor(playerB.id);
      const winnerId =
        returnA === null || returnB === null || Math.abs(returnA - returnB) < 0.0001
          ? null
          : returnA > returnB ? playerA.id : playerB.id;
      matchups.push({ week, playerA, playerB, returnA, returnB, winnerId, complete });
    }
  }
  return matchups;
}

export function personalityFor(types: string[]): string {
  const count = (type: string) => types.filter((value) => value === type).length;
  if (count("crypto") >= 4) return "Crypto Maximalist";
  if (count("etf") >= 5) return "ETF Strategist";
  if (count("equity") >= 7) return "Stock Picker";
  if (new Set(types).size >= 3) return "Chaos Diversifier";
  return "High-Conviction Investor";
}
