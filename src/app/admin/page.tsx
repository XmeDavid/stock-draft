"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { TYPES, SOURCES } from "@/lib/assets";

type Player = { id: number; name: string; strategy: string; color: string };
type Asset = {
  id: number; symbol: string; name: string; type: string;
  priceSource: string; sourceId: string; quoteCurrency: string;
};
type Position = { id: number; assetId: number; allocation: string | number };
type Race = { name: string; currency: string; startingCapital: number; status: string; startedAt: string | null };

const emptyPlayer = { name: "", strategy: "", color: "#8884d8" };
const emptyAsset = {
  symbol: "", name: "", type: "etf", priceSource: "yahoo", sourceId: "", quoteCurrency: "",
};

export default function AdminDashboard() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [players, setPlayers] = useState<Player[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [race, setRace] = useState<Race | null>(null);
  const [playerForm, setPlayerForm] = useState(emptyPlayer);
  const [assetForm, setAssetForm] = useState(emptyAsset);
  const [assetError, setAssetError] = useState("");
  const [selected, setSelected] = useState("");
  const [alloc, setAlloc] = useState<Record<number, string>>({});

  // Every request funnels through here so a 401 (expired/absent cookie) always
  // bounces to the login page and API `error` strings surface verbatim.
  const api = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const res = await fetch(path, init);
    if (res.status === 401) {
      router.push("/admin/login");
      throw new Error("Unauthorized");
    }
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
    return body as T;
  }, [router]);

  const load = useCallback(() => Promise.all([
    api<Player[]>("/api/admin/players"),
    api<Asset[]>("/api/admin/assets"),
    api<{ race: Race }>("/api/standings"),
  ]).then(([p, a, s]) => {
    setPlayers(p); setAssets(a); setRace(s.race);
  }).catch((e: Error) => setError(e.message)), [api]);

  useEffect(() => { void load(); }, [load]);

  // Wraps a mutation: clears banners, reports failures, refreshes on success.
  async function run(fn: () => Promise<void>, onError = setError) {
    setBusy(true); setError(""); setNotice("");
    try {
      await fn();
      await load();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const locked = race?.status === "running";
  const capital = race?.startingCapital ?? 0;
  const currency = race?.currency ?? "EUR";
  // Summed over the live asset list, not over `alloc`, so a stale entry for a
  // just-deleted asset can't inflate the total.
  const total = assets.reduce((s, a) => s + (parseFloat(alloc[a.id]) || 0), 0);
  const over = total > capital + 0.01;

  async function selectPlayer(id: string) {
    setSelected(id);
    setAlloc({});
    if (!id) return;
    try {
      const rows = await api<Position[]>(`/api/admin/positions?playerId=${id}`);
      setAlloc(Object.fromEntries(rows.map((r) => [r.assetId, String(Number(r.allocation))])));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function addPlayer(e: React.FormEvent) {
    e.preventDefault();
    void run(async () => {
      await api("/api/admin/players", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(playerForm),
      });
      setPlayerForm(emptyPlayer);
    });
  }

  function addAsset(e: React.FormEvent) {
    e.preventDefault();
    setAssetError("");
    void run(async () => {
      await api("/api/admin/assets", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...assetForm,
          quoteCurrency: assetForm.quoteCurrency.trim() || currency,
        }),
      });
      setAssetForm(emptyAsset);
    }, setAssetError);
  }

  function savePositions() {
    void run(async () => {
      await api("/api/admin/positions", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerId: Number(selected),
          positions: assets.map((a) => ({ assetId: a.id, allocation: parseFloat(alloc[a.id]) || 0 })),
        }),
      });
      setNotice("Positions saved.");
    });
  }

  function startRace() {
    if (!confirm("Start the race? This locks every position at current prices and cannot be undone.")) return;
    void run(async () => {
      await api("/api/admin/start", { method: "POST" });
      setNotice("Race started — positions locked at current prices.");
    });
  }

  const input = "rounded border p-2 text-sm";
  const btn = "rounded bg-gray-800 px-3 py-2 text-sm text-white hover:bg-gray-700 disabled:opacity-50";

  if (!race && !error) return <main className="p-8">Loading…</main>;

  return (
    <main className="mx-auto max-w-4xl space-y-8 p-4 sm:p-8">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Admin — {race?.name ?? "Race"}</h1>
        <Link href="/" className="text-sm text-blue-600 underline">View public page</Link>
      </header>

      {error && <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice && <p className="rounded border border-green-300 bg-green-50 p-3 text-sm text-green-700">{notice}</p>}
      {locked && (
        <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          Race running since {race?.startedAt?.slice(0, 10) ?? "—"}. Editing is disabled.
        </p>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Players</h2>
        <ul className="divide-y rounded border">
          {players.length === 0 && <li className="p-3 text-sm text-gray-500">No players yet.</li>}
          {players.map((p) => (
            <li key={p.id} className="flex items-center gap-3 p-3 text-sm">
              <span className="h-4 w-4 shrink-0 rounded" style={{ background: p.color }} />
              <span className="font-medium">{p.name}</span>
              <span className="truncate text-gray-500">{p.strategy}</span>
              <button
                className="ml-auto text-red-600 hover:underline disabled:opacity-50"
                disabled={locked || busy}
                onClick={() => {
                  if (!confirm(`Delete player ${p.name}?`)) return;
                  void run(() => api(`/api/admin/players/${p.id}`, { method: "DELETE" }).then(() => {}));
                }}
              >Delete</button>
            </li>
          ))}
        </ul>
        <form onSubmit={addPlayer} className="flex flex-wrap items-center gap-2">
          <input className={input} placeholder="Name" value={playerForm.name} required
            onChange={(e) => setPlayerForm({ ...playerForm, name: e.target.value })} />
          <input className={`${input} grow`} placeholder="Strategy" value={playerForm.strategy}
            onChange={(e) => setPlayerForm({ ...playerForm, strategy: e.target.value })} />
          <input type="color" className="h-9 w-12 rounded border" value={playerForm.color}
            onChange={(e) => setPlayerForm({ ...playerForm, color: e.target.value })} />
          <button className={btn} disabled={locked || busy}>Add player</button>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Assets</h2>
        <ul className="divide-y rounded border">
          {assets.length === 0 && <li className="p-3 text-sm text-gray-500">No assets yet.</li>}
          {assets.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
              <span className="font-mono font-medium">{a.symbol}</span>
              <span className="truncate text-gray-500">{a.name}</span>
              <span className="text-xs text-gray-400">
                {a.type} · {a.priceSource}{a.sourceId && ` · ${a.sourceId}`} · {a.quoteCurrency}
              </span>
              <button
                className="ml-auto text-red-600 hover:underline disabled:opacity-50"
                disabled={locked || busy}
                onClick={() => {
                  if (!confirm(`Delete asset ${a.symbol}?`)) return;
                  void run(() => api(`/api/admin/assets/${a.id}`, { method: "DELETE" }).then(() => {}));
                }}
              >Delete</button>
            </li>
          ))}
        </ul>
        {assetError && <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">{assetError}</p>}
        <form onSubmit={addAsset} className="flex flex-wrap items-center gap-2">
          <input className={input} placeholder="Symbol" value={assetForm.symbol} required
            onChange={(e) => setAssetForm({ ...assetForm, symbol: e.target.value })} />
          <input className={input} placeholder="Name" value={assetForm.name} required
            onChange={(e) => setAssetForm({ ...assetForm, name: e.target.value })} />
          <select className={input} value={assetForm.type}
            onChange={(e) => setAssetForm({ ...assetForm, type: e.target.value })}>
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className={input} value={assetForm.priceSource}
            onChange={(e) => setAssetForm({ ...assetForm, priceSource: e.target.value })}>
            {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input className={input} placeholder="sourceId (e.g. VWCE.DE)" value={assetForm.sourceId}
            onChange={(e) => setAssetForm({ ...assetForm, sourceId: e.target.value })} />
          <input className={`${input} w-24`} placeholder={currency} value={assetForm.quoteCurrency}
            onChange={(e) => setAssetForm({ ...assetForm, quoteCurrency: e.target.value })} />
          <button className={btn} disabled={locked || busy}>Add asset</button>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Positions</h2>
        <select className={input} value={selected} onChange={(e) => void selectPlayer(e.target.value)}>
          <option value="">Select a player…</option>
          {players.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {selected && (
          <>
            {assets.length === 0 && <p className="text-sm text-gray-500">Add assets first.</p>}
            <ul className="divide-y rounded border">
              {assets.map((a) => (
                <li key={a.id} className="flex items-center gap-3 p-3 text-sm">
                  <span className="font-mono">{a.symbol}</span>
                  <span className="truncate text-gray-500">{a.name}</span>
                  <input type="number" min="0" step="0.01" className={`${input} ml-auto w-32`}
                    value={alloc[a.id] ?? ""} disabled={locked}
                    onChange={(e) => setAlloc({ ...alloc, [a.id]: e.target.value })} />
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-4">
              <span className={`text-sm font-medium ${over ? "text-red-600" : "text-gray-700"}`}>
                {total.toLocaleString()} / {capital.toLocaleString()} {currency}
              </span>
              <button className={btn} onClick={savePositions} disabled={locked || busy || over || assets.length === 0}>
                Save positions
              </button>
            </div>
          </>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Start</h2>
        {locked ? (
          <p className="text-sm text-gray-700">Race running since {race?.startedAt?.slice(0, 10) ?? "—"}.</p>
        ) : (
          <button
            className="w-full rounded bg-red-600 p-3 font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            onClick={startRace} disabled={busy}
          >
            Start race — locks all positions at current prices
          </button>
        )}
      </section>
    </main>
  );
}
