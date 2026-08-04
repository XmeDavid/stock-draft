"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Leaderboard from "@/components/Leaderboard";
import { PageSkeleton, SeasonSkeleton } from "@/components/Skeletons";
import StandingsSection from "@/components/StandingsSection";
import DraftBoard, { type DraftState } from "@/components/DraftBoard";
import GameRules from "@/components/GameRules";
import PickReveal from "@/components/PickReveal";
import SeasonPanels from "@/components/SeasonPanels";
import {
  formatEuropeanDate,
  formatEuropeanDateTime,
  formatEuropeanTime,
} from "@/lib/dateFormat";

type Standings = {
  race: {
    name: string;
    currency: string;
    startingCapital: number;
    status: string;
    startedAt: string | null;
    endAt: string | null;
    finishedAt: string | null;
    daysRemaining: number | null;
    pricesAsOf: string | null;
    priceRefreshSeconds: number;
  };
  players: Parameters<typeof Leaderboard>[0]["players"];
  history: Record<string, number | string>[];
  weekly: Parameters<typeof SeasonPanels>[0]["weekly"];
  awards: Parameters<typeof SeasonPanels>[0]["awards"];
};

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

export default function Home() {
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [standings, setStandings] = useState<Standings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickError, setPickError] = useState("");
  const [mvpError, setMvpError] = useState("");
  const [refreshingPrices, setRefreshingPrices] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [strategy, setStrategy] = useState("");
  const [profileError, setProfileError] = useState("");
  const [profileNotice, setProfileNotice] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [revealPick, setRevealPick] = useState<DraftState["picks"][number] | null>(null);
  const seenPickCount = useRef<number | null>(null);

  const acceptDraft = useCallback((next: DraftState) => {
    if (seenPickCount.current !== null && next.picks.length > seenPickCount.current && next.status === "drafting") {
      setRevealPick(next.picks.at(-1) ?? null);
    }
    seenPickCount.current = next.picks.length;
    setDraft(next);
  }, []);

  // The draft payload is committed immediately so the page shell paints fast;
  // the season area shows skeletons until the slower standings fetch lands.
  const loadDraft = useCallback(async (refreshPrices = false) => {
    const nextDraft = await getJson<DraftState>("/api/draft");
    acceptDraft(nextDraft);
    if (nextDraft.status === "running" || nextDraft.status === "finished") {
      setStandings(await getJson<Standings>(refreshPrices ? "/api/standings?refresh=1" : "/api/standings"));
    }
    return nextDraft;
  }, [acceptDraft]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await loadDraft(true);
      } catch (cause) {
        if (!cancelled) setError(String(cause));
      }
    })();
    return () => { cancelled = true; };
  }, [loadDraft]);

  useEffect(() => {
    const syncRulesHash = () => {
      if (window.location.hash === "#rules") setRulesOpen(true);
    };
    const timer = window.setTimeout(syncRulesHash, 0);
    window.addEventListener("hashchange", syncRulesHash);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("hashchange", syncRulesHash);
    };
  }, []);

  useEffect(() => {
    const needsPoll =
      draft?.status === "drafting" ||
      draft?.status === "drafted" ||
      ((draft?.status === "running" || draft?.status === "finished") && !standings);
    if (!needsPoll) return;
    const timer = window.setInterval(() => { loadDraft().catch(() => {}); }, 2000);
    return () => window.clearInterval(timer);
  }, [draft?.status, standings, loadDraft]);

  // The quote endpoint caches prices for five minutes, but a lightweight
  // minute poll keeps snapshots, countdowns, and a newly finished season from
  // requiring a manual reload.
  useEffect(() => {
    if (draft?.status !== "running") return;
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const next = await getJson<Standings>("/api/standings");
          setStandings(next);
          if (next.race.status === "finished") await loadDraft();
        } catch {
          // Keep the last good standings visible through transient quote/API errors.
        }
      })();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [draft?.status, loadDraft]);

  async function refreshPrices() {
    setRefreshingPrices(true);
    try {
      setStandings(await getJson<Standings>("/api/standings?refresh=1"));
    } finally {
      setRefreshingPrices(false);
    }
  }

  const onPick = useCallback(async (symbol: string) => {
    setPickError("");
    try {
      const response = await fetch("/api/draft/pick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol }),
      });
      if (!response.ok) {
        setPickError(((await response.json().catch(() => ({}))) as { error?: string }).error ?? `Pick failed (HTTP ${response.status})`);
      }
    } catch (cause) {
      setPickError(String(cause));
    }
    await loadDraft().catch(() => {});
  }, [loadDraft]);

  const onChooseMvp = useCallback(async (symbol: string) => {
    setMvpError("");
    try {
      const response = await fetch("/api/draft/mvp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol }),
      });
      if (!response.ok) {
        setMvpError(((await response.json().catch(() => ({}))) as { error?: string }).error ?? `MVP selection failed (HTTP ${response.status})`);
      }
    } catch (cause) {
      setMvpError(String(cause));
    }
    await loadDraft().catch(() => {});
  }, [loadDraft]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    await loadDraft().catch(() => {});
  }

  async function saveStrategy(e: React.FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    setProfileError("");
    setProfileNotice("");
    try {
      const response = await fetch("/api/player/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strategy }),
      });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`);
      await loadDraft();
      setStrategy(strategy.trim());
      setProfileNotice("Strategy saved.");
    } catch (cause) {
      setProfileError((cause as Error).message);
    } finally {
      setSavingProfile(false);
    }
  }

  if (error) return <main className="p-8">Failed to load: {error}</main>;
  if (!draft) return <PageSkeleton />;

  const loggedIn = draft.yourPlayerId !== null;
  const me = loggedIn ? draft.roster.find((player) => player.id === draft.yourPlayerId) : undefined;
  const inSeason = draft.status === "running" || draft.status === "finished";
  const showInlineRules = !loggedIn && draft.status === "registration";

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-8">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/70 bg-white/75 p-4 shadow-sm backdrop-blur dark:border-white/10 dark:bg-gray-950/65 sm:p-5">
        <div>
          <p className="mb-1 text-xs font-bold uppercase tracking-[0.22em] text-indigo-600 dark:text-indigo-400">Office stock league</p>
          <h1 className="text-2xl font-bold">{standings?.race.name ?? draft.raceName}</h1>
          <p className="text-sm text-gray-500">
            {inSeason && standings?.race.startedAt
              ? `Started ${formatEuropeanDate(standings.race.startedAt)} · ${standings.race.startingCapital.toLocaleString()} ${standings.race.currency} each`
              : draft.status === "registration"
                ? "Race is forming"
                : draft.status === "drafting"
                  ? "Draft in progress"
                  : "Draft complete"}
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          {showInlineRules ? (
            <button
              type="button"
              onClick={() => {
                setRulesOpen(true);
                window.requestAnimationFrame(() => {
                  document.getElementById("rules")?.scrollIntoView({ behavior: "smooth", block: "start" });
                });
              }}
              className="cursor-pointer rounded border px-3 py-2 font-semibold hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              How to play
            </button>
          ) : (
            <Link href="/rules" className="text-xs font-semibold text-gray-500 underline hover:text-gray-900 dark:hover:text-gray-100">
              Rules
            </Link>
          )}
          {loggedIn ? (
            <>
              <span className="hidden text-gray-500 sm:inline">logged in as {me?.name ?? me?.username ?? "player"}</span>
              <button
                type="button"
                onClick={() => {
                  setStrategy(me?.strategy ?? "");
                  setProfileError("");
                  setProfileNotice("");
                  setProfileOpen((open) => !open);
                }}
                className="rounded border px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Edit strategy
              </button>
              <button onClick={logout} className="rounded border px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800">Log out</button>
            </>
          ) : draft.status === "registration" ? (
            <a href="/register" className="rounded bg-gray-800 px-3 py-2 text-white hover:bg-gray-700">Register</a>
          ) : (
            <a href="/login" className="rounded bg-gray-800 px-3 py-2 text-white hover:bg-gray-700">Log in</a>
          )}
          {inSeason && (
            <a href="/api/export" className="rounded bg-gray-800 px-3 py-2 text-white hover:bg-gray-700">Export .xlsx</a>
          )}
        </div>
      </header>

      {loggedIn && profileOpen && (
        <section className="rounded-2xl border border-indigo-200 bg-indigo-50/70 p-4 dark:border-indigo-900 dark:bg-indigo-950/20">
          <form className="space-y-3" onSubmit={saveStrategy}>
            <div>
              <label htmlFor="player-strategy" className="font-semibold">Your strategy</label>
              <p className="mt-1 text-xs text-gray-500">
                A short description shown on your player card. It does not affect scoring or limit your picks.
              </p>
            </div>
            <textarea
              id="player-strategy"
              value={strategy}
              onChange={(e) => setStrategy(e.target.value)}
              maxLength={160}
              rows={3}
              placeholder="For example: Long-term growth with a soft spot for semiconductors"
              className="w-full rounded-lg border border-gray-300 bg-white p-3 text-sm dark:border-gray-700 dark:bg-gray-950"
              autoFocus
            />
            <div className="flex flex-wrap items-center gap-3">
              <button
                disabled={savingProfile}
                className="rounded bg-gray-800 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-700 disabled:opacity-50"
              >
                {savingProfile ? "Saving…" : "Save strategy"}
              </button>
              <span className="text-xs text-gray-500">{strategy.length}/160</span>
              {profileError && <span className="text-sm text-red-600">{profileError}</span>}
              {profileNotice && <span className="text-sm text-green-700 dark:text-green-400">{profileNotice}</span>}
            </div>
          </form>
        </section>
      )}

      {showInlineRules && (
        <GameRules
          currency={draft.currency}
          picksPerPlayer={draft.picksPerPlayer}
          perPickAmount={draft.perPickAmount}
          open={rulesOpen}
          onOpenChange={setRulesOpen}
        />
      )}

      {(draft.status === "registration" || draft.status === "drafting") && draft.scheduledStartAt && (
        <section className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm dark:border-emerald-900 dark:bg-emerald-950/30">
          <div>
            <p className="font-bold text-emerald-900 dark:text-emerald-100">
              Automatic start planned for {formatEuropeanDateTime(draft.scheduledStartAt)}
            </p>
            <p className="text-emerald-800/80 dark:text-emerald-200/70">
              The race starts once the draft and every MVP choice are complete.
            </p>
          </div>
        </section>
      )}

      {inSeason && !standings ? (
        <SeasonSkeleton />
      ) : inSeason && standings ? (
        <>
          <section className="grid gap-3 rounded-2xl bg-gray-900 p-5 text-white shadow-xl sm:grid-cols-[1fr_auto] sm:items-center">
            <div>
              <p className="text-sm uppercase tracking-widest text-gray-400">
                {standings.race.status === "finished" ? "Final standings" : "Race to year-end"}
              </p>
              <p className="mt-1 text-2xl font-black">
                {standings.race.status === "finished"
                  ? "The market has closed on this race."
                  : `${standings.race.daysRemaining ?? "—"} days remaining`}
              </p>
            </div>
            <div className="text-left sm:text-right">
              {standings.race.endAt && <time className="block font-mono text-sm text-gray-300">Ends {formatEuropeanDateTime(standings.race.endAt)}</time>}
              {standings.race.status === "running" && (
                <div className="mt-2 flex flex-wrap items-center gap-2 sm:justify-end">
                  <span className="text-xs text-gray-400">
                    Quotes {standings.race.pricesAsOf
                      ? `updated ${formatEuropeanTime(standings.race.pricesAsOf)}`
                      : "unavailable"}
                    {" · "}auto every {Math.round(standings.race.priceRefreshSeconds / 60)} min
                  </span>
                  <button
                    type="button"
                    onClick={() => void refreshPrices()}
                    disabled={refreshingPrices}
                    className="cursor-pointer rounded-lg bg-white/10 px-3 py-1.5 text-xs font-bold transition hover:bg-white/20 disabled:opacity-50"
                  >
                    {refreshingPrices ? "Refreshing…" : "Refresh prices"}
                  </button>
                </div>
              )}
            </div>
          </section>
          <StandingsSection
            history={standings.history}
            players={standings.players}
            startingCapital={standings.race.startingCapital}
            currency={standings.race.currency}
            raceStatus={standings.race.status}
          />
          <SeasonPanels weekly={standings.weekly} awards={standings.awards} />
        </>
      ) : draft.status === "registration" ? (
        <section className="space-y-3">
          <p className="text-gray-600 dark:text-gray-300">
            Race is forming {!loggedIn && <>— <a href="/register" className="underline">register to join</a></>}
          </p>
          <h2 className="text-lg font-semibold">Players ({draft.roster.length})</h2>
          {draft.roster.length === 0 ? (
            <p className="text-sm text-gray-500">Nobody has joined yet.</p>
          ) : (
            <ul className="space-y-2">
              {draft.roster.map((player) => (
                <li key={player.id} className="flex items-center gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                  <span className="h-3 w-3 rounded-full" style={{ background: player.color }} />
                  <span className="font-semibold">{player.name}</span>
                  <span className="text-sm text-gray-500">@{player.username}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <DraftBoard draft={draft} onPick={onPick} onChooseMvp={onChooseMvp} pickError={pickError} mvpError={mvpError} />
      )}

      {revealPick && (
        <PickReveal
          key={revealPick.pickIndex}
          pick={revealPick}
          player={draft.roster.find((player) => player.id === revealPick.playerId)}
          onDone={() => setRevealPick(null)}
        />
      )}
    </main>
  );
}
