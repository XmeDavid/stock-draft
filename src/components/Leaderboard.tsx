"use client";
import { useState } from "react";

type Position = { symbol: string; name: string; quantity: number; startPrice: number; currentPrice: number; value: number; gainPct: number };
type Player = { id: number; name: string; strategy: string; color: string; currentValue: number; gainPct: number; stale: boolean; positions: Position[] };

const fmt = (n: number, d = 2) => n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });

export default function Leaderboard({ players, currency }: { players: Player[]; currency: string }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="space-y-2">
      {players.map((p, i) => (
        <div key={p.id} className="rounded-lg border border-gray-200 dark:border-gray-700">
          <button className="flex w-full items-center gap-3 p-3 text-left" onClick={() => setOpen(open === p.id ? null : p.id)}>
            <span className="w-6 text-lg font-bold">{i + 1}</span>
            <span className="h-3 w-3 rounded-full" style={{ background: p.color }} />
            <span className="flex-1">
              <span className="font-semibold">{p.name}</span>
              {p.strategy && <span className="ml-2 text-sm text-gray-500">{p.strategy}</span>}
              {p.stale && <span className="ml-2 text-xs text-amber-500" title="Some prices unavailable — showing last known">⚠ stale</span>}
            </span>
            <span className="font-mono">{fmt(p.currentValue)} {currency}</span>
            <span className={`w-24 text-right font-mono ${p.gainPct >= 0 ? "text-green-600" : "text-red-600"}`}>
              {p.gainPct >= 0 ? "+" : ""}{fmt(p.gainPct)}%
            </span>
          </button>
          {open === p.id && (
            <table className="w-full border-t border-gray-200 text-sm dark:border-gray-700">
              <thead><tr className="text-left text-gray-500">
                <th className="p-2">Asset</th><th className="p-2 text-right">Qty</th>
                <th className="p-2 text-right">Start</th><th className="p-2 text-right">Now</th>
                <th className="p-2 text-right">Value</th><th className="p-2 text-right">Gain</th>
              </tr></thead>
              <tbody>
                {p.positions.map((pos) => (
                  <tr key={pos.symbol}>
                    <td className="p-2">{pos.symbol} <span className="text-gray-500">{pos.name}</span></td>
                    <td className="p-2 text-right font-mono">{fmt(pos.quantity, 4)}</td>
                    <td className="p-2 text-right font-mono">{fmt(pos.startPrice)}</td>
                    <td className="p-2 text-right font-mono">{fmt(pos.currentPrice)}</td>
                    <td className="p-2 text-right font-mono">{fmt(pos.value)}</td>
                    <td className={`p-2 text-right font-mono ${pos.gainPct >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {pos.gainPct >= 0 ? "+" : ""}{fmt(pos.gainPct)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </div>
  );
}
