"use client";

type Matchup = {
  week: number;
  playerA: { id: number; name: string };
  playerB: { id: number; name: string };
  returnA: number | null;
  returnB: number | null;
  winnerId: number | null;
  complete: boolean;
};
type TableRow = { playerId: number; name: string; wins: number; draws: number; losses: number; points: number };
type Award = { title: string; player: string; detail: string };

const pct = (value: number | null) => {
  if (value === null) return "—";
  const clean = Math.abs(value) < 0.005 ? 0 : value;
  return `${clean >= 0 ? "+" : ""}${clean.toFixed(2)}%`;
};

export default function SeasonPanels({
  weekly,
  awards,
}: {
  weekly: { matchups: Matchup[]; table: TableRow[]; currentWeek: number };
  awards: Award[];
}) {
  const current = weekly.matchups.filter((matchup) => matchup.week === weekly.currentWeek);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
        <h2 className="text-lg font-bold">Weekly head-to-head</h2>
        <p className="mb-3 text-sm text-gray-500">Week {weekly.currentWeek || 1} · 3 points for a win, 1 for a draw</p>
        <div className="space-y-2">
          {current.length === 0 && <p className="text-sm text-gray-500">Fixtures appear after the race starts.</p>}
          {current.map((matchup) => (
            <div key={`${matchup.week}-${matchup.playerA.id}-${matchup.playerB.id}`} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-lg bg-gray-50 p-3 text-sm dark:bg-gray-900">
              <span className={matchup.winnerId === matchup.playerA.id ? "font-bold" : ""}>{matchup.playerA.name}<small className="block font-mono text-gray-500">{pct(matchup.returnA)}</small></span>
              <span className="text-xs font-bold text-gray-400">VS</span>
              <span className={`text-right ${matchup.winnerId === matchup.playerB.id ? "font-bold" : ""}`}>{matchup.playerB.name}<small className="block font-mono text-gray-500">{pct(matchup.returnB)}</small></span>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
        <h2 className="text-lg font-bold">Match points</h2>
        <div className="mt-3 space-y-2 text-sm">
          {weekly.table.map((row, index) => (
            <div key={row.playerId} className="flex items-center gap-3">
              <span className="w-5 font-bold">{index + 1}</span>
              <span className="flex-1 font-semibold">{row.name}</span>
              <span className="text-gray-500">{row.wins}W {row.draws}D {row.losses}L</span>
              <span className="w-8 text-right font-mono font-bold">{row.points}</span>
            </div>
          ))}
        </div>
      </section>

      {awards.length > 0 && (
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 lg:col-span-2 dark:border-amber-800 dark:bg-amber-950/30">
          <h2 className="text-xl font-black">Season awards</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {awards.map((award) => (
              <div key={award.title} className="rounded-lg bg-white p-4 text-center shadow-sm dark:bg-gray-900">
                <span className="text-2xl">🏆</span>
                <h3 className="mt-1 font-bold">{award.title}</h3>
                <p>{award.player}</p>
                <p className="text-xs text-gray-500">{award.detail}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
