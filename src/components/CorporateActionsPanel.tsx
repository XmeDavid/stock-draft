"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type BookPosition = {
  positionId: number;
  playerName: string;
  symbol: string;
  name: string;
  quantity: number;
  startPrice: number;
  allocation: number;
  isMvp: boolean;
};

type Alert = {
  playerName: string;
  symbol: string;
  name: string;
  hint: string | null;
  priceBasis: string | null;
};

type Kind = "split" | "stock" | "cash" | "rename";

const input = "rounded border p-2 text-sm";
const btn = "rounded bg-gray-800 px-3 py-2 text-sm text-white hover:bg-gray-700 disabled:opacity-50";

export default function CorporateActionsPanel() {
  const router = useRouter();
  const [positions, setPositions] = useState<BookPosition[] | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<Kind>("split");
  const [symbol, setSymbol] = useState("");
  const [ratio, setRatio] = useState("2");
  const [acquirerSymbol, setAcquirerSymbol] = useState("");
  const [acquirerName, setAcquirerName] = useState("");
  const [cashPerShare, setCashPerShare] = useState("");
  const [toSymbol, setToSymbol] = useState("");
  const [quoteCurrency, setQuoteCurrency] = useState("");
  const [edits, setEdits] = useState<Record<number, { quantity: string; startPrice: string }>>({});

  const load = useCallback(async () => {
    const [bookRes, standingsRes] = await Promise.all([
      fetch("/api/admin/corporate-actions", { cache: "no-store" }),
      fetch("/api/standings", { cache: "no-store" }),
    ]);
    if (bookRes.status === 401 || standingsRes.status === 401) {
      router.push("/admin/login");
      throw new Error("Unauthorized");
    }
    const book = await bookRes.json() as { error?: string; positions?: BookPosition[] };
    if (!bookRes.ok) throw new Error(book.error ?? `HTTP ${bookRes.status}`);
    const standings = await standingsRes.json() as {
      players?: {
        name: string;
        positions: {
          symbol: string;
          name: string;
          possibleCorporateAction?: boolean;
          hint?: string | null;
          priceBasis?: string;
        }[];
      }[];
    };
    return {
      positions: book.positions ?? [],
      alerts: (standings.players ?? []).flatMap((player) =>
        player.positions
          .filter((position) => position.possibleCorporateAction)
          .map((position) => ({
            playerName: player.name,
            symbol: position.symbol,
            name: position.name,
            hint: position.hint ?? null,
            priceBasis: position.priceBasis ?? null,
          }))
      ),
    };
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    void load().then((book) => {
      if (cancelled) return;
      setPositions(book.positions);
      setEdits(Object.fromEntries(book.positions.map((position) => [
        position.positionId,
        { quantity: String(position.quantity), startPrice: String(position.startPrice) },
      ])));
      setAlerts(book.alerts);
    }).catch((loadError: Error) => {
      if (!cancelled && loadError.message !== "Unauthorized") setError(loadError.message);
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function submit(payload: unknown, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/admin/corporate-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 401) {
        router.push("/admin/login");
        return;
      }
      const body = await res.json().catch(() => null) as { error?: string; summary?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      setNotice(body?.summary ?? "Saved.");
      await load();
    } catch (submitError) {
      setError((submitError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function onApply(event: React.FormEvent) {
    event.preventDefault();
    const ticker = symbol.trim().toUpperCase();
    if (!ticker) {
      setError("Symbol is required");
      return;
    }
    if (kind === "split") {
      void submit(
        { kind, symbol: ticker, ratio: Number(ratio) },
        `Apply a ${ratio}-for-1 split to every ${ticker} position? Share count and cost basis both adjust, so the position value stays put.`,
      );
      return;
    }
    if (kind === "cash") {
      void submit(
        { kind, symbol: ticker, cashPerShare: Number(cashPerShare) },
        `Convert ${ticker} to cash at ${cashPerShare} per share? The position stops tracking the market.`,
      );
      return;
    }
    if (kind === "rename") {
      void submit(
        { kind, symbol: ticker, toSymbol, name: acquirerName || undefined },
        `Rename ${ticker} to ${toSymbol.trim().toUpperCase()} with no share adjustment?`,
      );
      return;
    }
    void submit(
      {
        kind,
        symbol: ticker,
        acquirerSymbol,
        ratio: Number(ratio),
        acquirerName: acquirerName || undefined,
        quoteCurrency: quoteCurrency || undefined,
      },
      `Convert ${ticker} into ${acquirerSymbol.trim().toUpperCase()} at ${ratio} share(s) per share? Original allocations stay the cost basis. If someone else already drafted the acquirer, both keep it.`,
    );
  }

  return (
    <section className="space-y-4 rounded-xl border border-amber-300 bg-amber-50/60 p-4 dark:border-amber-800 dark:bg-amber-950/20">
      <div>
        <h2 className="text-lg font-semibold">Corporate actions</h2>
        <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
          When a drafted ticker is acquired, renamed, delisted, or split, record it here.
          A missing quote stays on the leaderboard at its last snapshot value and is marked
          as a possible corporate action — it is not reset to the starting price. A split
          scales the share count so an MVP is not wiped by the lower post-split price.
          Stock and cash deals keep the original allocation as the cost basis. The
          no-duplicates rule applies only at draft time, so two players may both hold the acquirer.
        </p>
      </div>

      {error && <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice && <p className="rounded border border-green-300 bg-green-50 p-3 text-sm text-green-700">{notice}</p>}

      {alerts.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Needs a look</h3>
          <ul className="space-y-1 text-sm">
            {alerts.map((alert) => (
              <li key={`${alert.playerName}-${alert.symbol}`} className="rounded border border-amber-400 bg-white px-3 py-2 dark:bg-gray-950">
                <strong className="font-mono">{alert.symbol}</strong>
                <span> · {alert.playerName}</span>
                <span className="block text-xs text-gray-600 dark:text-gray-400">
                  {alert.name}
                  {alert.priceBasis === "last-snapshot" ? " · valued at last snapshot" : ""}
                  {alert.priceBasis === "start" ? " · no snapshot yet, flagged at the start price" : ""}
                </span>
                {alert.hint && <span className="block text-xs text-amber-800 dark:text-amber-200">{alert.hint}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <form className="space-y-3" onSubmit={onApply}>
        <div className="flex flex-wrap gap-2">
          <label className="space-y-1 text-sm">
            <span className="block text-xs text-gray-500">Action</span>
            <select className={input} value={kind} onChange={(event) => setKind(event.target.value as Kind)}>
              <option value="split">Split</option>
              <option value="stock">Stock-for-stock</option>
              <option value="cash">Cash buyout</option>
              <option value="rename">Rename ticker</option>
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="block text-xs text-gray-500">Drafted symbol</span>
            <input className={`${input} w-28 font-mono uppercase`} value={symbol} onChange={(event) => setSymbol(event.target.value)} required />
          </label>
          {(kind === "split" || kind === "stock") && (
            <label className="space-y-1 text-sm">
              <span className="block text-xs text-gray-500">{kind === "split" ? "New shares per old share" : "Acquirer shares per old share"}</span>
              <input className={`${input} w-28 font-mono`} inputMode="decimal" value={ratio} onChange={(event) => setRatio(event.target.value)} required />
            </label>
          )}
          {kind === "cash" && (
            <label className="space-y-1 text-sm">
              <span className="block text-xs text-gray-500">Cash per share</span>
              <input className={`${input} w-28 font-mono`} inputMode="decimal" value={cashPerShare} onChange={(event) => setCashPerShare(event.target.value)} required />
            </label>
          )}
          {kind === "stock" && (
            <label className="space-y-1 text-sm">
              <span className="block text-xs text-gray-500">Acquirer symbol</span>
              <input className={`${input} w-28 font-mono uppercase`} value={acquirerSymbol} onChange={(event) => setAcquirerSymbol(event.target.value)} required />
            </label>
          )}
          {kind === "stock" && (
            <label className="space-y-1 text-sm">
              <span className="block text-xs text-gray-500">Quote currency (optional)</span>
              <input className={`${input} w-24 font-mono uppercase`} value={quoteCurrency} maxLength={3} onChange={(event) => setQuoteCurrency(event.target.value)} />
            </label>
          )}
          {kind === "rename" && (
            <label className="space-y-1 text-sm">
              <span className="block text-xs text-gray-500">New symbol</span>
              <input className={`${input} w-28 font-mono uppercase`} value={toSymbol} onChange={(event) => setToSymbol(event.target.value)} required />
            </label>
          )}
          {(kind === "stock" || kind === "rename") && (
            <label className="space-y-1 text-sm">
              <span className="block text-xs text-gray-500">Name (optional)</span>
              <input className={`${input} w-48`} value={acquirerName} onChange={(event) => setAcquirerName(event.target.value)} />
            </label>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={btn} disabled={busy} type="submit">Apply to the race</button>
          <button
            className="rounded border px-3 py-2 text-sm hover:bg-white disabled:opacity-50 dark:hover:bg-gray-900"
            disabled={busy}
            type="button"
            onClick={() => void submit({ kind: "sync" })}
          >
            Sync splits and mapped deals
          </button>
        </div>
      </form>

      {positions && positions.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-max text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500">
                <th className="p-2">Player</th>
                <th className="p-2">Symbol</th>
                <th className="p-2">Quantity</th>
                <th className="p-2">Start price</th>
                <th className="p-2">Allocation</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {positions.map((position) => {
                const edit = edits[position.positionId] ?? {
                  quantity: String(position.quantity),
                  startPrice: String(position.startPrice),
                };
                return (
                  <tr key={position.positionId} className="border-t border-amber-200 dark:border-amber-900">
                    <td className="p-2">{position.playerName}{position.isMvp ? " ★" : ""}</td>
                    <td className="p-2 font-mono">
                      {position.symbol}
                      <span className="block max-w-40 truncate text-xs text-gray-500">{position.name}</span>
                    </td>
                    <td className="p-2">
                      <input
                        className={`${input} w-28 font-mono`}
                        value={edit.quantity}
                        onChange={(event) => setEdits({
                          ...edits,
                          [position.positionId]: { ...edit, quantity: event.target.value },
                        })}
                      />
                    </td>
                    <td className="p-2">
                      <input
                        className={`${input} w-28 font-mono`}
                        value={edit.startPrice}
                        onChange={(event) => setEdits({
                          ...edits,
                          [position.positionId]: { ...edit, startPrice: event.target.value },
                        })}
                      />
                    </td>
                    <td className="p-2 font-mono">{position.allocation}</td>
                    <td className="p-2">
                      <button
                        type="button"
                        className={btn}
                        disabled={busy}
                        onClick={() => void submit({
                          kind: "edit",
                          positionId: position.positionId,
                          quantity: Number(edit.quantity),
                          startPrice: Number(edit.startPrice),
                        }, `Update ${position.playerName}'s ${position.symbol} position?`)}
                      >
                        Save
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
