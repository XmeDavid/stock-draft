"use client";
import { useEffect } from "react";
import AssetLogo from "@/components/AssetLogo";
import type { DraftPick, DraftPlayer } from "@/components/DraftBoard";

export default function PickReveal({
  pick,
  player,
  onDone,
}: {
  pick: DraftPick;
  player?: DraftPlayer;
  onDone: () => void;
}) {
  useEffect(() => {
    const timer = window.setTimeout(onDone, 3200);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDone();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onDone, pick.pickIndex]);

  return (
    <div
      className="pick-reveal fixed inset-0 z-50 grid place-items-center bg-black/75 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`${player?.name ?? "Player"} drafted ${pick.symbol}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onDone();
      }}
    >
      <div className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-white/20 bg-gray-950 p-8 text-center text-white shadow-2xl">
        <button
          type="button"
          onClick={onDone}
          className="absolute right-4 top-4 z-10 grid h-9 w-9 place-items-center rounded-full border border-white/20 bg-white/10 text-xl text-white transition hover:bg-white/20"
          aria-label="Close pick reveal"
          autoFocus
        >
          ×
        </button>
        <div className="confetti" aria-hidden="true">
          {Array.from({ length: 24 }, (_, index) => (
            <i
              key={index}
              style={{
                "--i": index,
                left: `${(index + 1) * 4}%`,
                animationDelay: `${(index % 7) * 0.07}s`,
                background: `hsl(${index * 47}deg 90% 60%)`,
              } as React.CSSProperties}
            />
          ))}
        </div>
        <p className="relative text-sm font-semibold uppercase tracking-[0.35em] text-gray-400">
          Pick #{pick.pickIndex + 1}
        </p>
        <p className="relative mt-4 text-2xl font-black uppercase" style={{ color: player?.color }}>
          {player?.name ?? "A player"} drafts
        </p>
        <AssetLogo
          src={pick.logoUrl}
          symbol={pick.symbol}
          name={pick.name}
          size={112}
          color={player?.color}
          className="ticker-emblem relative mx-auto mt-6 rounded-3xl text-2xl shadow-lg"
        />
        <h2 className="relative mt-5 font-mono text-5xl font-black tracking-tight">{pick.symbol}</h2>
        <p className="relative mt-2 text-gray-300">{pick.name}</p>
      </div>
    </div>
  );
}
