"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import DraftBoard, { type DraftState } from "@/components/DraftBoard";

type Race = { name: string; currency: string; status: string; startedAt: string | null; endAt: string | null };
type AdminRace = { inviteCode: string; picksPerPlayer: number };
type RaceSettings = {
  name: string;
  currency: string;
  endAt: string;
  startAt: string;
  picksPerPlayer: number;
};

function localDateTimeValue(iso: string | null): string {
  if (!iso) return `${new Date().getFullYear()}-12-31T23:59`;
  const date = new Date(iso);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export default function AdminConsole() {
  const router = useRouter();
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [race, setRace] = useState<Race | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [pickError, setPickError] = useState("");
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  // Seeded from the race once loaded, then left alone so a refresh mid-edit
  // (including the 5 s draft poll) can't overwrite what is being typed.
  const [settings, setSettings] = useState<RaceSettings | null>(null);

  // Every request funnels through here so a 401 (expired/absent cookie) always
  // bounces to the login page and API `error` strings surface verbatim.
  const api = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const res = await fetch(path, { cache: "no-store", ...init });
    if (res.status === 401) {
      router.push("/admin/login");
      throw new Error("Unauthorized");
    }
    const body = await res.json().catch(() => null) as { error?: string } | null;
    if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
    return body as T;
  }, [router]);

  const post = useCallback(
    <T,>(path: string, payload?: unknown) => api<T>(path, {
      method: "POST",
      ...(payload === undefined ? {} : {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    }),
    [api]
  );

  // `/api/draft` is the phase source of truth; `/api/standings` supplies public
  // race details, and the authenticated race endpoint supplies the invite code.
  const load = useCallback(() => Promise.all([
    api<DraftState>("/api/draft"),
    api<{ race: Race }>("/api/standings"),
    api<AdminRace>("/api/admin/race"),
  ]).then(([d, s, adminRace]) => {
    setDraft(d);
    setRace(s.race);
    setInviteCode((prev) => prev ?? adminRace.inviteCode);
    setSettings((prev) => prev ?? {
      name: s.race.name,
      currency: s.race.currency,
      endAt: localDateTimeValue(s.race.endAt),
      startAt: d.scheduledStartAt ? localDateTimeValue(d.scheduledStartAt) : "",
      picksPerPlayer: adminRace.picksPerPlayer,
    });
  }), [api]);

  useEffect(() => {
    load().catch((e: Error) => setError(e.message));
  }, [load]);

  // Poll while the draft is live so the board advances without a reload; keep
  // polling once drafted so the auto-start flip to `running` is picked up.
  useEffect(() => {
    if (draft?.status !== "drafting" && draft?.status !== "drafted") return;
    const t = setInterval(() => { load().catch(() => {}); }, 5000);
    return () => clearInterval(t);
  }, [draft?.status, load]);

  // Wraps a mutation: clears banners, reports failures, refreshes on success.
  function run(fn: () => Promise<string | void>) {
    setBusy(true); setError(""); setNotice("");
    void (async () => {
      try {
        const msg = await fn();
        if (msg) setNotice(msg);
        await load();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    })();
  }

  const onPick = useCallback(async (symbol: string) => {
    setPickError("");
    try {
      await post("/api/admin/draft/pick", { symbol });
    } catch (e) {
      setPickError((e as Error).message);
    }
    await load().catch(() => {});
  }, [post, load]);

  const onChooseMvpForPlayer = useCallback(async (playerId: number, symbol: string) => {
    setPickError("");
    try {
      await post("/api/admin/draft/mvp", { playerId, symbol });
    } catch (e) {
      setPickError((e as Error).message);
    }
    await load().catch(() => {});
  }, [post, load]);

  const input = "rounded border p-2 text-sm";
  const btn = "rounded bg-gray-800 px-3 py-2 text-sm text-white hover:bg-gray-700 disabled:opacity-50";
  const danger = "rounded bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50";

  if (!draft || !race || !settings || inviteCode === null) {
    return <main className="p-8">{error ? `Failed to load: ${error}` : "Loading…"}</main>;
  }

  const phase = draft.status;

  return (
    <main className="mx-auto max-w-4xl space-y-8 p-4 sm:p-8">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Admin — {race.name}</h1>
          <p className="text-sm text-gray-500">Phase: {phase}</p>
        </div>
        <Link href="/" className="text-sm text-blue-600 underline">View public page</Link>
      </header>

      {error && <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice && <p className="rounded border border-green-300 bg-green-50 p-3 text-sm text-green-700">{notice}</p>}

      {(phase === "drafting" || phase === "drafted") && !race.endAt && (
        <section className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
          <h2 className="text-lg font-semibold">Set the race end</h2>
          <p className="text-sm">This draft predates the end-date setting. Choose the final market cutoff before starting the race.</p>
          <div className="flex flex-wrap gap-2">
            <input className={input} type="datetime-local" required value={settings.endAt}
              onChange={(e) => setSettings({ ...settings, endAt: e.target.value })} />
            <button className={btn} disabled={busy} onClick={() => run(async () => {
              await api("/api/admin/race", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ endAt: new Date(settings.endAt).toISOString() }),
              });
              return "Race end date saved.";
            })}>Save end date</button>
          </div>
        </section>
      )}

      {phase === "registration" && (
        <>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Race settings</h2>
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  await api("/api/admin/race", {
                    method: "PUT", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      name: settings.name,
                      currency: settings.currency,
                      endAt: new Date(settings.endAt).toISOString(),
                      picksPerPlayer: settings.picksPerPlayer,
                    }),
                  });
                  await post("/api/admin/schedule", {
                    startAt: settings.startAt ? new Date(settings.startAt).toISOString() : null,
                  });
                  return "Race settings saved.";
                });
              }}
            >
              <div className="grid w-full gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-sm font-medium">
                  <span>Race name</span>
                  <input className={`${input} w-full`} placeholder="Office Stock League" required value={settings.name}
                    onChange={(e) => setSettings({ ...settings, name: e.target.value })} />
                </label>
                <label className="space-y-1 text-sm font-medium">
                  <span>Currency</span>
                  <input className={`${input} w-full uppercase`} placeholder="EUR" maxLength={3} required
                    value={settings.currency}
                    onChange={(e) => setSettings({ ...settings, currency: e.target.value })} />
                </label>
                <label className="space-y-1 text-sm font-medium">
                  <span>Stock picks per player</span>
                  <input
                    className={`${input} w-full`}
                    type="number"
                    min={1}
                    max={100}
                    step={1}
                    required
                    value={settings.picksPerPlayer}
                    onChange={(e) => setSettings({
                      ...settings,
                      picksPerPlayer: e.target.valueAsNumber,
                    })}
                  />
                </label>
                <label className="space-y-1 text-sm font-medium">
                  <span>Automatic start <span className="font-normal text-gray-500">(optional)</span></span>
                  <input className={`${input} w-full`} type="datetime-local" value={settings.startAt}
                    onChange={(e) => setSettings({ ...settings, startAt: e.target.value })} />
                </label>
                <label className="space-y-1 text-sm font-medium">
                  <span>Race ends</span>
                  <input className={`${input} w-full`} type="datetime-local" required value={settings.endAt}
                    onChange={(e) => setSettings({ ...settings, endAt: e.target.value })} />
                </label>
              </div>
              <button className={btn} disabled={busy}>Save settings</button>
            </form>
            <p className="text-xs text-gray-500">
              Times use your local timezone. Auto-start waits until the draft and all MVP choices are complete.
              Currency is a 3-letter code, e.g. EUR. Pick count locks when the draft starts.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Invite code</h2>
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  await api("/api/admin/race", {
                    method: "PUT", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ inviteCode }),
                  });
                  return inviteCode.trim()
                    ? "Invite code saved."
                    : "Invite code cleared — registration is closed.";
                });
              }}
            >
              <input className={`${input} grow font-mono`} placeholder="New invite code" value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)} />
              <button className={btn} disabled={busy}>Save invite code</button>
            </form>
            <p className="text-xs text-gray-500">
              Saving an empty code closes registration — nobody can join until you set a new one.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Players ({draft.roster.length})</h2>
            <ul className="divide-y rounded border">
              {draft.roster.length === 0 && <li className="p-3 text-sm text-gray-500">Nobody has joined yet.</li>}
              {draft.roster.map((p) => (
                <li key={p.id} className="flex items-center gap-3 p-3 text-sm">
                  <span className="h-4 w-4 shrink-0 rounded" style={{ background: p.color }} />
                  <span className="font-medium">{p.name}</span>
                  <span className="truncate text-gray-500">@{p.username}</span>
                  <button
                    className="ml-auto text-red-600 hover:underline disabled:opacity-50"
                    disabled={busy}
                    onClick={() => {
                      if (!confirm(`Remove player ${p.name}?`)) return;
                      run(async () => {
                        await api(`/api/admin/players/${p.id}`, { method: "DELETE" });
                        return `${p.name} removed.`;
                      });
                    }}
                  >Remove</button>
                </li>
              ))}
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Start draft</h2>
            <button
              className={danger}
              disabled={busy || draft.roster.length < 2}
              onClick={() => {
                if (!confirm("Start the draft? Registration closes and the pick order is locked.")) return;
                run(async () => {
                  await post("/api/admin/draft/start");
                  return "Draft started.";
                });
              }}
            >
              Start draft — closes registration
            </button>
            {draft.roster.length < 2 && (
              <p className="text-xs text-gray-500">At least 2 players are needed to start the draft.</p>
            )}
          </section>
        </>
      )}

      {phase === "drafting" && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Draft</h2>
          <DraftBoard draft={draft} onPick={onPick} pickError={pickError} adminPick />
        </section>
      )}

      {phase === "drafted" && (
        <>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Draft result</h2>
            <DraftBoard
              draft={draft}
              onPick={onPick}
              onChooseMvpForPlayer={onChooseMvpForPlayer}
              pickError={pickError}
              mvpError={pickError}
              adminMvp
            />
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Start the race</h2>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {draft.scheduledStartAt
                ? `Scheduled to start ${new Date(draft.scheduledStartAt).toLocaleString()}.`
                : "No start scheduled."}
            </p>
            <p className="text-sm">
              MVPs locked: <strong>{draft.mvpLockedCount}/{draft.roster.length}</strong>
              {draft.mvpRevealed ? " — all choices revealed." : " — waiting for every player."}
            </p>
            <button
              className={danger}
              disabled={busy || !draft.mvpRevealed}
              onClick={() => {
                if (!confirm("Start the race now? Every pick locks at the current price and this cannot be undone.")) return;
                run(async () => {
                  await post("/api/admin/start");
                  return "Race started — picks locked at current prices.";
                });
              }}
            >
              Start race now — locks all picks at current prices
            </button>
            <div className="flex flex-wrap items-center gap-2">
              <input type="datetime-local" className={input} value={settings.startAt}
                onChange={(e) => setSettings({ ...settings, startAt: e.target.value })} />
              <button
                className={btn}
                disabled={busy || !settings.startAt}
                onClick={() => run(async () => {
                  await post("/api/admin/schedule", { startAt: new Date(settings.startAt).toISOString() });
                  return "Start scheduled.";
                })}
              >Schedule start</button>
              <button
                className="rounded border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50 dark:hover:bg-gray-800"
                disabled={busy || !draft.scheduledStartAt}
                onClick={() => run(async () => {
                  await post("/api/admin/schedule", { startAt: null });
                  setSettings({ ...settings, startAt: "" });
                  return "Schedule cleared.";
                })}
              >Clear schedule</button>
            </div>
            <p className="text-xs text-gray-500">The scheduled time must be in the future and uses your local timezone.</p>
          </section>
        </>
      )}

      {(phase === "running" || phase === "finished") && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">{phase === "finished" ? "Race finished" : "Race running"}</h2>
          <p className="text-sm text-gray-700 dark:text-gray-300">
            Race running since {race.startedAt ? new Date(race.startedAt).toLocaleString() : "—"}.
          </p>
          {phase === "running" && (
            <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
              <h3 className="font-semibold">Race ending</h3>
              <p className="mt-1 text-xs text-gray-500">You can move the deadline while the race is running. It must remain in the future.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <input
                  className={input}
                  type="datetime-local"
                  required
                  value={settings.endAt}
                  onChange={(e) => setSettings({ ...settings, endAt: e.target.value })}
                />
                <button
                  type="button"
                  className={`${btn} cursor-pointer`}
                  disabled={busy || !settings.endAt}
                  onClick={() => run(async () => {
                    await api("/api/admin/race", {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ endAt: new Date(settings.endAt).toISOString() }),
                    });
                    return "Race end date updated.";
                  })}
                >
                  Update ending date
                </button>
              </div>
            </div>
          )}
          <Link href="/" className="text-sm text-blue-600 underline">Open the public standings</Link>
        </section>
      )}
    </main>
  );
}
