"use client";
import { useState } from "react";

export type DraftPlayer = { id: number; name: string; username: string; color: string };
export type DraftPick = { pickIndex: number; playerId: number; symbol: string; name: string };

export type DraftState = {
  status: string;
  roster: DraftPlayer[];
  order: number[];
  currentPickIndex: number;
  currentPlayerId: number | null;
  yourPlayerId: number | null;
  yourTurn: boolean;
  picksPerPlayer: number;
  perPickAmount: number;
  scheduledStartAt: string | null;
  picks: DraftPick[];
};

export default function DraftBoard({
  draft, onPick, pickError,
}: {
  draft: DraftState;
  onPick: (symbol: string) => void | Promise<void>;
  pickError?: string;
}) {
  const [symbol, setSymbol] = useState("");
  const { order, roster, picks, picksPerPlayer, status } = draft;

  const byId = new Map(roster.map((p) => [p.id, p]));
  const columns = order.map((id) => byId.get(id)).filter((p): p is DraftPlayer => p !== undefined);
  const byPickIndex = new Map(picks.map((p) => [p.pickIndex, p]));
  const n = order.length;
  const round = n > 0 ? Math.floor(draft.currentPickIndex / n) + 1 : 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const s = symbol.trim();
    if (!s) return;
    await onPick(s);
    setSymbol("");
  }

  return (
    <div className="space-y-4">
      {status === "drafted" && (
        <div className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm dark:border-green-800 dark:bg-green-950">
          <span className="font-semibold">Draft complete — waiting for start</span>
          {draft.scheduledStartAt && (
            <span className="ml-2 text-gray-600 dark:text-gray-400">
              scheduled for {new Date(draft.scheduledStartAt).toLocaleString()}
            </span>
          )}
        </div>
      )}

      {status === "drafting" && (
        <div className="space-y-2">
          <p className="text-sm text-gray-500">
            Round {round} of {picksPerPlayer} · {draft.perPickAmount.toLocaleString()} per pick
          </p>
          <ul className="flex flex-wrap gap-2">
            {columns.map((p) => {
              const active = p.id === draft.currentPlayerId;
              return (
                <li key={p.id}
                  className={`flex items-center gap-2 rounded-full border px-3 py-1 text-sm ${
                    active
                      ? "border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900"
                      : "border-gray-300 dark:border-gray-700"
                  }`}>
                  <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
                  {p.name}
                  {p.id === draft.yourPlayerId && <span className="text-xs opacity-70">(you)</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-sm">
          <thead>
            <tr>
              <th className="border-b border-gray-200 p-2 text-left font-normal text-gray-500 dark:border-gray-700">
                Round
              </th>
              {columns.map((p) => (
                <th key={p.id}
                  className="border-b border-gray-200 p-2 text-left font-semibold dark:border-gray-700">
                  {p.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: picksPerPlayer }, (_, r) => (
              <tr key={r}>
                <td className="border-b border-gray-100 p-2 text-gray-500 dark:border-gray-800">{r + 1}</td>
                {columns.map((p, c) => {
                  const pickIndex = r * n + (r % 2 === 0 ? c : n - 1 - c);
                  const pick = byPickIndex.get(pickIndex);
                  const isCurrent = status === "drafting" && pickIndex === draft.currentPickIndex;
                  return (
                    <td key={p.id}
                      className={`border-b border-gray-100 p-2 dark:border-gray-800 ${
                        isCurrent ? "bg-yellow-50 dark:bg-yellow-950" : ""
                      }`}>
                      {pick ? (
                        <>
                          <span className="font-mono font-semibold">{pick.symbol}</span>
                          <span className="block text-xs text-gray-500">{pick.name}</span>
                        </>
                      ) : (
                        <span className="text-gray-300 dark:text-gray-600">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {draft.yourTurn && (
        <form onSubmit={submit} className="space-y-2">
          <div className="flex gap-2">
            <input value={symbol} onChange={(e) => setSymbol(e.target.value)}
              placeholder="Ticker (e.g. AAPL)" className="flex-1 rounded border p-2 font-mono uppercase" autoFocus />
            <button className="rounded bg-gray-800 px-4 py-2 text-white">Draft</button>
          </div>
          {pickError && <p className="text-sm text-red-600">{pickError}</p>}
        </form>
      )}
      {!draft.yourTurn && pickError && <p className="text-sm text-red-600">{pickError}</p>}
    </div>
  );
}
