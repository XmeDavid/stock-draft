"use client";
import { useCallback, useEffect, useState } from "react";
import Chart from "@/components/Chart";
import Leaderboard from "@/components/Leaderboard";
import DraftBoard, { type DraftState } from "@/components/DraftBoard";

type Standings = {
  race: { name: string; currency: string; startingCapital: number; status: string; startedAt: string | null };
  players: Parameters<typeof Leaderboard>[0]["players"];
  history: Record<string, number | string>[];
};

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

export default function Home() {
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [standings, setStandings] = useState<Standings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickError, setPickError] = useState("");

  // Loads the draft state, and the standings too once the race is running
  // (a poll can see the phase flip to running, and the chart needs them).
  // Both are fetched before either is committed, so a failed standings fetch
  // never leaves the page showing `running` with no standings to render.
  const loadDraft = useCallback(async () => {
    const d = await getJson<DraftState>("/api/draft");
    const s = d.status === "running" ? await getJson<Standings>("/api/standings") : null;
    setDraft(d);
    if (s) setStandings(s);
    return d;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadDraft();
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [loadDraft]);

  // Poll while the draft is live so the board advances without a reload; keep
  // polling once drafted so the auto-start flip to `running` is picked up, and
  // keep retrying if we somehow reached `running` without standings.
  useEffect(() => {
    const needsPoll =
      draft?.status === "drafting" ||
      draft?.status === "drafted" ||
      (draft?.status === "running" && !standings);
    if (!needsPoll) return;
    const t = setInterval(() => {
      loadDraft().catch(() => {});
    }, 5000);
    return () => clearInterval(t);
  }, [draft?.status, standings, loadDraft]);

  const onPick = useCallback(
    async (symbol: string) => {
      setPickError("");
      try {
        const res = await fetch("/api/draft/pick", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol }),
        });
        if (!res.ok) {
          setPickError((await res.json().catch(() => ({}))).error ?? `Pick failed (HTTP ${res.status})`);
        }
      } catch (e) {
        setPickError(String(e));
      }
      await loadDraft().catch(() => {});
    },
    [loadDraft]
  );

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    await loadDraft().catch(() => {});
  }

  if (error) return <main className="p-8">Failed to load: {error}</main>;
  if (!draft) return <main className="p-8">Loading…</main>;

  const loggedIn = draft.yourPlayerId !== null;
  const me = loggedIn ? draft.roster.find((p) => p.id === draft.yourPlayerId) : undefined;
  const running = draft.status === "running";

  if (running && !standings) return <main className="p-8">Loading…</main>;

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-4 sm:p-8">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{standings?.race.name ?? "Race to 1 Million"}</h1>
          <p className="text-sm text-gray-500">
            {running && standings?.race.startedAt
              ? `Started ${standings.race.startedAt.slice(0, 10)} · ${standings.race.startingCapital.toLocaleString()} ${standings.race.currency} each`
              : draft.status === "registration"
                ? "Race is forming"
                : draft.status === "drafting"
                  ? "Draft in progress"
                  : "Draft complete"}
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          {loggedIn ? (
            <>
              <span className="text-gray-500">logged in as {me?.name ?? me?.username ?? "player"}</span>
              <button onClick={logout} className="rounded border px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800">
                Log out
              </button>
            </>
          ) : (
            draft.status === "registration" && (
              <a href="/register" className="rounded bg-gray-800 px-3 py-2 text-white hover:bg-gray-700">
                Register
              </a>
            )
          )}
          {running && (
            <a href="/api/export" className="rounded bg-gray-800 px-3 py-2 text-white hover:bg-gray-700">
              Export .xlsx
            </a>
          )}
        </div>
      </header>

      {running && standings ? (
        <>
          <Chart history={standings.history} players={standings.players} startingCapital={standings.race.startingCapital} />
          <Leaderboard players={standings.players} currency={standings.race.currency} />
        </>
      ) : draft.status === "registration" ? (
        <section className="space-y-3">
          <p className="text-gray-600 dark:text-gray-300">
            Race is forming{" "}
            {!loggedIn && (
              <>
                — <a href="/register" className="underline">register to join</a>
              </>
            )}
          </p>
          <h2 className="text-lg font-semibold">Players ({draft.roster.length})</h2>
          {draft.roster.length === 0 ? (
            <p className="text-sm text-gray-500">Nobody has joined yet.</p>
          ) : (
            <ul className="space-y-2">
              {draft.roster.map((p) => (
                <li key={p.id} className="flex items-center gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                  <span className="h-3 w-3 rounded-full" style={{ background: p.color }} />
                  <span className="font-semibold">{p.name}</span>
                  <span className="text-sm text-gray-500">@{p.username}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <DraftBoard draft={draft} onPick={onPick} pickError={pickError} />
      )}
    </main>
  );
}
