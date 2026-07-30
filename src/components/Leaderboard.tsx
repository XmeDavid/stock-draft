"use client";
import { useState } from "react";
import AssetLogo from "@/components/AssetLogo";
import ProfileChart from "@/components/ProfileChart";

type Position = {
  assetId: number;
  symbol: string;
  name: string;
  logoUrl: string;
  startPrice: number;
  currentPrice: number;
  value: number;
  todayGainPct: number | null;
  gainPct: number;
  marketGainPct: number;
  isMvp: boolean;
};
type Player = {
  id: number;
  name: string;
  strategy: string;
  color: string;
  currentValue: number;
  gainPct: number;
  stale: boolean;
  rankMovement: number;
  daysLed: number;
  personality: string;
  achievements: string[];
  bestPick: Position | null;
  worstPick: Position | null;
  positions: Position[];
  profileHistory: Record<string, number | string>[];
};

const clean = (n: number) => Math.abs(n) < 0.005 ? 0 : n;
const fmt = (n: number, d = 2) => clean(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
const signed = (n: number) => `${clean(n) >= 0 ? "+" : ""}${fmt(n)}%`;

export default function Leaderboard({ players, currency }: { players: Player[]; currency: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const [sort, setSort] = useState<{ key: "symbol" | "startPrice" | "currentPrice" | "value" | "todayGainPct" | "gainPct"; direction: 1 | -1 }>({
    key: "gainPct",
    direction: -1,
  });

  function sortBy(key: typeof sort.key) {
    setSort((current) => current.key === key
      ? { key, direction: current.direction === 1 ? -1 : 1 }
      : { key, direction: key === "symbol" ? 1 : -1 });
  }

  function heading(label: string, key: typeof sort.key, align = "text-right") {
    return (
      <button type="button" onClick={() => sortBy(key)} className={`w-full cursor-pointer p-3 ${align} font-semibold hover:text-indigo-600`}>
        {label}{sort.key === key ? (sort.direction === 1 ? " ↑" : " ↓") : ""}
      </button>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-950/70">
      <div className="grid grid-cols-[2.5rem_1fr_auto_auto] gap-3 border-b border-gray-200 bg-gray-50 px-4 py-2 text-xs font-bold uppercase tracking-wider text-gray-500 dark:border-gray-800 dark:bg-gray-900">
        <span>Rank</span><span>Player</span><span>Value</span><span className="w-20 text-right">Return</span>
      </div>
      {players.map((p, i) => (
        <div key={p.id} className="border-b border-gray-200 last:border-b-0 dark:border-gray-800">
          <button className="grid w-full cursor-pointer grid-cols-[2.5rem_1fr_auto_auto] items-center gap-3 p-4 text-left transition hover:bg-indigo-50/70 dark:hover:bg-indigo-950/20" onClick={() => setOpen(open === p.id ? null : p.id)}>
            <span className="text-lg font-black">{i + 1}</span>
            <span className="flex min-w-0 items-center gap-3">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: p.color }} />
              <span className="min-w-0">
                <span className="block truncate font-semibold">{p.name}</span>
                <span className={`block text-xs font-semibold ${
                  p.rankMovement > 0 ? "text-green-600" : p.rankMovement < 0 ? "text-red-600" : "text-gray-400"
                }`}>
                  {p.rankMovement > 0 ? `↑${p.rankMovement}` : p.rankMovement < 0 ? `↓${Math.abs(p.rankMovement)}` : "No rank change"}
                  {p.strategy ? ` · ${p.strategy}` : ""}
                  {p.stale && <span className="ml-2 text-amber-500" title="Some prices unavailable — showing last known">⚠ stale</span>}
                </span>
              </span>
            </span>
            <span className="font-mono text-sm font-semibold">{fmt(p.currentValue)} {currency}</span>
            <span className={`w-20 text-right font-mono font-bold ${clean(p.gainPct) >= 0 ? "text-green-600" : "text-red-600"}`}>
              {signed(p.gainPct)}
            </span>
          </button>
          {open === p.id && (
            <div className="border-t border-gray-200 dark:border-gray-700">
              <div className="grid gap-3 bg-gray-50 p-3 text-sm sm:grid-cols-2 lg:grid-cols-5 dark:bg-gray-900/50">
                <div><span className="block text-xs text-gray-500">Portfolio personality</span><strong>{p.personality}</strong></div>
                <div><span className="block text-xs text-gray-500">Days in first</span><strong>{p.daysLed}</strong></div>
                <div><span className="block text-xs text-gray-500">Best pick</span><strong className="font-mono">{p.bestPick?.symbol ?? "—"}</strong><small className="ml-1 text-green-600">{p.bestPick ? signed(p.bestPick.gainPct) : ""}</small></div>
                <div><span className="block text-xs text-gray-500">Worst pick</span><strong className="font-mono">{p.worstPick?.symbol ?? "—"}</strong><small className="ml-1 text-red-600">{p.worstPick ? signed(p.worstPick.gainPct) : ""}</small></div>
                <div>
                  <span className="block text-xs text-gray-500">Achievements</span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {p.achievements.length > 0
                      ? p.achievements.map((achievement) => <span key={achievement} className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900 dark:bg-amber-900 dark:text-amber-100">{achievement}</span>)
                      : <span className="text-gray-400">None earned yet</span>}
                  </div>
                </div>
              </div>
              <ProfileChart
                history={p.profileHistory}
                symbols={p.positions.filter((position) => position.symbol !== "CASH").map((position) => position.symbol)}
                playerColor={p.color}
              />
              <div className="overflow-x-auto border-t border-gray-200 dark:border-gray-800">
                <table className="w-full min-w-max text-sm">
                  <thead><tr className="text-left text-gray-500">
                    <th>{heading("Asset", "symbol", "text-left")}</th>
                    <th>{heading("Start", "startPrice")}</th>
                    <th>{heading("Now", "currentPrice")}</th>
                    <th>{heading("Value", "value")}</th>
                    <th>{heading("Today", "todayGainPct")}</th>
                    <th>{heading("Overall", "gainPct")}</th>
                  </tr></thead>
                  <tbody>
                    {[...p.positions].sort((a, b) => {
                      const left = a[sort.key] ?? Number.NEGATIVE_INFINITY;
                      const right = b[sort.key] ?? Number.NEGATIVE_INFINITY;
                      return typeof left === "string" && typeof right === "string"
                        ? left.localeCompare(right) * sort.direction
                        : (Number(left) - Number(right)) * sort.direction;
                    }).map((pos) => (
                      <tr key={pos.symbol} className={pos.isMvp ? "bg-amber-50 dark:bg-amber-950/30" : ""}>
                        <td className="p-3">
                          <span className="flex items-center gap-2">
                            <AssetLogo src={pos.logoUrl} symbol={pos.symbol} name={pos.name} size={34} color={p.color} />
                            <span>
                              <strong className="font-mono">{pos.isMvp && <span className="mr-1 text-amber-500" title="MVP — profit and loss count 2×">★</span>}{pos.symbol}</strong>
                              <span className="block max-w-56 truncate text-xs text-gray-500">{pos.name}</span>
                            </span>
                          </span>
                        </td>
                        <td className="p-3 text-right font-mono">{fmt(pos.startPrice)}</td>
                        <td className="p-3 text-right font-mono">{fmt(pos.currentPrice)}</td>
                        <td className="p-3 text-right font-mono">{fmt(pos.value)}</td>
                        <td className={`p-3 text-right font-mono ${pos.todayGainPct === null ? "text-gray-400" : clean(pos.todayGainPct) >= 0 ? "text-green-600" : "text-red-600"}`}>
                          {pos.todayGainPct === null ? "—" : signed(pos.todayGainPct)}
                        </td>
                        <td className={`p-3 text-right font-mono ${clean(pos.gainPct) >= 0 ? "text-green-600" : "text-red-600"}`}>
                          {signed(pos.gainPct)}
                          {pos.isMvp && <span className="block text-[10px] text-gray-500">market {signed(pos.marketGainPct)}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
