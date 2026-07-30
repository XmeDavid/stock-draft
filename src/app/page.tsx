"use client";
import { useEffect, useState } from "react";
import Chart from "@/components/Chart";
import Leaderboard from "@/components/Leaderboard";

type Standings = {
  race: { name: string; currency: string; startingCapital: number; status: string; startedAt: string | null };
  players: Parameters<typeof Leaderboard>[0]["players"];
  history: Record<string, number | string>[];
};

export default function Home() {
  const [data, setData] = useState<Standings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/standings")
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(setData)
      .catch((e) => setError(String(e)));
  }, []);

  if (error) return <main className="p-8">Failed to load: {error}</main>;
  if (!data) return <main className="p-8">Loading…</main>;

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-4 sm:p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{data.race.name}</h1>
          <p className="text-sm text-gray-500">
            {data.race.status === "running" && data.race.startedAt
              ? `Started ${data.race.startedAt.slice(0, 10)} · ${data.race.startingCapital.toLocaleString()} ${data.race.currency} each`
              : "Race not started yet"}
          </p>
        </div>
        <a href="/api/export" className="rounded bg-gray-800 px-3 py-2 text-sm text-white hover:bg-gray-700">
          Export .xlsx
        </a>
      </header>
      {data.race.status === "running" && (
        <Chart history={data.history} players={data.players} startingCapital={data.race.startingCapital} />
      )}
      <Leaderboard players={data.players} currency={data.race.currency} />
    </main>
  );
}
