"use client";
import { useRef, useState } from "react";
import Chart from "@/components/Chart";
import Leaderboard from "@/components/Leaderboard";

type Range = "all" | "1d" | "1w";
type IntradayData = { range: Range; degraded: boolean; history: Record<string, number | string>[] };

const RANGE_LABELS: { key: Range; label: string }[] = [
  { key: "1d", label: "1D" },
  { key: "1w", label: "1W" },
  { key: "all", label: "All" },
];

const CLIENT_CACHE_TTL_MS = 60_000;
type RangeCache = Map<Range, { at: number; data: IntradayData }>;

function readRangeCache(cache: RangeCache, range: Range): IntradayData | null {
  const hit = cache.get(range);
  return hit && Date.now() - hit.at < CLIENT_CACHE_TTL_MS ? hit.data : null;
}

function writeRangeCache(cache: RangeCache, range: Range, data: IntradayData) {
  cache.set(range, { at: Date.now(), data });
}

export default function StandingsSection({ history, players, startingCapital, currency, raceStatus }: {
  history: Record<string, number | string>[];
  players: Parameters<typeof Leaderboard>[0]["players"];
  startingCapital: number;
  currency: string;
  raceStatus: string;
}) {
  const [openId, setOpenId] = useState<number | null>(null);
  const [hoverId, setHoverId] = useState<number | null>(null);
  const [range, setRange] = useState<Range>("all");
  const [intraday, setIntraday] = useState<IntradayData | null>(null);
  const [rangeError, setRangeError] = useState(false);
  const cacheRef = useRef<RangeCache>(new Map());

  async function selectRange(next: Range) {
    setRange(next);
    setRangeError(false);
    if (next === "all") return;
    const cached = readRangeCache(cacheRef.current, next);
    if (cached) {
      setIntraday(cached);
      return;
    }
    try {
      const response = await fetch(`/api/standings/intraday?range=${next}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = { ...(await response.json()), range: next } as IntradayData;
      writeRangeCache(cacheRef.current, next, data);
      setIntraday(data);
    } catch {
      setRange("all");
      setRangeError(true);
    }
  }

  const intradayReady = range !== "all" && intraday?.range === range;
  const loadingRange = range !== "all" && !intradayReady;

  return (
    <>
      <div>
        {raceStatus === "running" && (
          <div className="mb-2 flex items-center justify-end gap-1">
            {rangeError && <span className="mr-2 text-xs text-amber-500">Intraday data unavailable right now</span>}
            {intradayReady && intraday.degraded && (
              <span className="mr-2 text-xs text-amber-500">Some prices unavailable — holding the last known price</span>
            )}
            {RANGE_LABELS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => void selectRange(key)}
                className={`cursor-pointer rounded-full px-3 py-1 text-xs font-bold transition ${
                  range === key
                    ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
                    : "text-gray-500 hover:text-gray-900 dark:hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <div className={loadingRange ? "animate-pulse opacity-50 transition-opacity" : undefined}>
          <Chart
            history={intradayReady ? intraday.history : history}
            players={players}
            startingCapital={startingCapital}
            highlightId={hoverId ?? openId}
            onHighlight={setHoverId}
            timeRange={intradayReady ? intraday.range as "1d" | "1w" : null}
          />
        </div>
      </div>
      <Leaderboard players={players} currency={currency} onOpenChange={setOpenId} />
    </>
  );
}
