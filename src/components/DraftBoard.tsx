"use client";
import AssetLogo from "@/components/AssetLogo";
import StockPicker from "@/components/StockPicker";

export type DraftPlayer = { id: number; name: string; username: string; strategy: string; color: string };
export type DraftPick = {
  pickIndex: number;
  playerId: number;
  symbol: string;
  name: string;
  type: string;
  logoUrl: string;
  isMvp: boolean;
};

export type DraftState = {
  raceName: string;
  currency: string;
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
  endAt: string | null;
  mvpLockedCount: number;
  mvpPlayerIds: number[];
  mvpRevealed: boolean;
  yourMvpSymbol: string | null;
  picks: DraftPick[];
};

export default function DraftBoard({
  draft, onPick, onChooseMvp, onChooseMvpForPlayer, pickError, mvpError, adminPick = false, adminMvp = false,
}: {
  draft: DraftState;
  onPick: (symbol: string) => void | Promise<void>;
  onChooseMvp?: (symbol: string) => void | Promise<void>;
  onChooseMvpForPlayer?: (playerId: number, symbol: string) => void | Promise<void>;
  pickError?: string;
  mvpError?: string;
  /** Admin variant: the pick form stays visible for whoever is on the clock. */
  adminPick?: boolean;
  /** Admin variant: show unresolved players and allow an on-behalf MVP lock. */
  adminMvp?: boolean;
}) {
  const { order, roster, picks, picksPerPlayer, status } = draft;

  const byId = new Map(roster.map((p) => [p.id, p]));
  const currentPlayer = draft.currentPlayerId === null ? undefined : byId.get(draft.currentPlayerId);
  const canPick = adminPick ? status === "drafting" && currentPlayer !== undefined : draft.yourTurn;
  const columns = order.map((id) => byId.get(id)).filter((p): p is DraftPlayer => p !== undefined);
  const byPickIndex = new Map(picks.map((p) => [p.pickIndex, p]));
  const n = order.length;
  const round = n > 0 ? Math.floor(draft.currentPickIndex / n) + 1 : 0;

  return (
    <div className="space-y-5">
      {status === "drafted" && (
        <div className="rounded-2xl border border-emerald-300 bg-emerald-50/90 p-4 text-sm shadow-sm dark:border-emerald-800 dark:bg-emerald-950/50">
          <span className="font-bold text-emerald-900 dark:text-emerald-100">✓ Draft complete — waiting for start</span>
          {draft.scheduledStartAt && (
            <span className="ml-2 text-gray-600 dark:text-gray-400">
              scheduled for {new Date(draft.scheduledStartAt).toLocaleString()}
            </span>
          )}
        </div>
      )}

      {status === "drafting" && (
        <div className="rounded-2xl bg-gradient-to-br from-gray-950 via-indigo-950 to-violet-950 p-5 text-white shadow-xl shadow-indigo-950/10">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-indigo-300">On the clock</p>
              <p className="mt-1 text-2xl font-black">{currentPlayer?.name ?? "Draft complete"}</p>
            </div>
            <p className="rounded-full bg-white/10 px-3 py-1.5 text-xs text-indigo-100">
              Round {round}/{picksPerPlayer} · {draft.perPickAmount.toLocaleString()} {draft.currency}
            </p>
          </div>
          <ul className="mt-4 flex flex-wrap gap-2">
            {columns.map((p) => {
              const active = p.id === draft.currentPlayerId;
              return (
                <li key={p.id}
                  className={`flex items-center gap-2 rounded-full border px-3 py-1 text-sm ${
                    active
                      ? "border-white bg-white font-semibold text-gray-950"
                      : "border-white/15 bg-white/5 text-gray-300"
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

      <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900/80">
        <table className="w-full min-w-max border-collapse text-sm">
          <thead>
            <tr>
              <th className="border-b border-gray-200 p-2 text-left font-normal text-gray-500 dark:border-gray-700">
                Round
              </th>
              {columns.map((p) => (
                <th key={p.id}
                  className="border-b border-gray-200 p-3 text-left font-semibold dark:border-gray-700">
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
                      className={`border-b border-gray-100 p-3 dark:border-gray-800 ${
                        isCurrent ? "bg-indigo-50 ring-2 ring-inset ring-indigo-400 dark:bg-indigo-950/40" : ""
                      }`}>
                      {pick ? (
                        <div className="flex items-center gap-2.5">
                          <AssetLogo src={pick.logoUrl} symbol={pick.symbol} name={pick.name} size={36} color={p.color} />
                          <span className="min-w-0">
                            <span className="block font-mono font-semibold">
                              {pick.isMvp && <span className="mr-1 text-amber-500" title="MVP pick">★</span>}
                              {pick.symbol}
                            </span>
                            <span className="block max-w-36 truncate text-xs text-gray-500">{pick.name}</span>
                          </span>
                        </div>
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

      {canPick && (
        <StockPicker
          key={`${draft.currentPickIndex}-${currentPlayer?.id ?? "player"}`}
          label={adminPick ? `Pick for ${currentPlayer?.name}` : "Your pick — find an asset"}
          onConfirm={onPick}
          error={pickError}
        />
      )}
      {!canPick && pickError && <p className="text-sm text-red-600">{pickError}</p>}

      {status === "drafted" && (
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/40">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-semibold">Choose your MVP</h3>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Its profit or loss counts 2×, with its value floored at zero.
              </p>
            </div>
            <span className="rounded-full bg-white px-3 py-1 text-sm dark:bg-gray-900">
              {draft.mvpLockedCount}/{roster.length} locked
            </span>
          </div>

          {adminMvp && onChooseMvpForPlayer ? (
            <div className="mt-3 space-y-3">
              {roster.map((player) => {
                const locked = draft.mvpPlayerIds.includes(player.id);
                const playerPicks = picks.filter((pick) => pick.playerId === player.id);
                return (
                  <div key={player.id} className="rounded-lg bg-white p-3 dark:bg-gray-900">
                    <div className="flex items-center gap-2">
                      <strong>{player.name}</strong>
                      <span className={`ml-auto text-xs ${locked ? "text-green-600" : "text-amber-700 dark:text-amber-300"}`}>
                        {locked ? "Locked" : "Waiting"}
                      </span>
                    </div>
                    {!locked && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {playerPicks.map((pick) => (
                          <button
                            key={pick.symbol}
                            type="button"
                            className="rounded border px-2 py-1 font-mono text-xs hover:bg-gray-50 dark:hover:bg-gray-800"
                            onClick={() => {
                              if (confirm(`Lock ${pick.symbol} as ${player.name}'s MVP? This cannot be changed.`)) {
                                void onChooseMvpForPlayer(player.id, pick.symbol);
                              }
                            }}
                          >
                            {pick.symbol}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : draft.yourPlayerId === null ? (
            <p className="mt-3 text-sm"><a className="underline" href="/login">Log in</a> to lock your MVP.</p>
          ) : draft.yourMvpSymbol ? (
            <p className="mt-3 font-semibold">
              Your MVP is locked{draft.mvpRevealed ? `: ★ ${draft.yourMvpSymbol}` : " — waiting for the reveal…"}
            </p>
          ) : onChooseMvp ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {picks.filter((pick) => pick.playerId === draft.yourPlayerId).map((pick) => (
                <button
                  key={pick.symbol}
                  type="button"
                  className="rounded-lg border border-amber-300 bg-white p-3 text-left transition hover:-translate-y-0.5 hover:shadow-md dark:border-amber-700 dark:bg-gray-900"
                  onClick={() => {
                    if (confirm(`Lock ${pick.symbol} as your MVP? This cannot be changed.`)) {
                      void onChooseMvp(pick.symbol);
                    }
                  }}
                >
                  <span className="block font-mono font-bold">{pick.symbol}</span>
                  <span className="block truncate text-xs text-gray-500">{pick.name}</span>
                </button>
              ))}
            </div>
          ) : null}
          {mvpError && <p className="mt-2 text-sm text-red-600">{mvpError}</p>}

          {draft.mvpRevealed && (
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {roster.map((player) => {
                const mvp = picks.find((pick) => pick.playerId === player.id && pick.isMvp);
                return (
                  <div key={player.id} className="flex items-center gap-3 rounded-lg bg-white p-3 dark:bg-gray-900">
                    <span className="text-xl">★</span>
                    <span className="font-semibold">{player.name}</span>
                    <span className="ml-auto font-mono font-bold">{mvp?.symbol}</span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
