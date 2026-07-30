"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import GameRules from "@/components/GameRules";

type RulesConfig = {
  currency: string;
  picksPerPlayer: number;
  perPickAmount: number;
};

export default function RulesPageContent() {
  const [config, setConfig] = useState<RulesConfig | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/draft", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<RulesConfig>;
      })
      .then((next) => {
        if (!cancelled) setConfig(next);
      })
      .catch((cause) => {
        if (!cancelled) setError(String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto w-full max-w-4xl space-y-5 p-4 sm:p-8">
      <nav aria-label="Rules navigation">
        <Link href="/" className="text-sm font-semibold text-indigo-700 underline dark:text-indigo-300">
          ← Back to the race
        </Link>
      </nav>

      {error ? (
        <p className="rounded border border-red-300 bg-red-50 p-4 text-sm text-red-700">
          Could not load the current race rules: {error}
        </p>
      ) : config ? (
        <GameRules {...config} open onOpenChange={() => {}} />
      ) : (
        <p className="p-8 text-center text-gray-500">Loading the rules…</p>
      )}
    </main>
  );
}
