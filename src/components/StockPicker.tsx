"use client";
import { useEffect, useState } from "react";
import AssetLogo from "@/components/AssetLogo";

type SearchResult = {
  symbol: string;
  name: string;
  type: string;
  exchange: string;
  logoUrl: string;
  alternatives: Listing[];
};

type Listing = Omit<SearchResult, "alternatives">;

type Preview = SearchResult & {
  price: number;
  currency: string;
};

export default function StockPicker({
  onConfirm,
  label,
  error,
}: {
  onConfirm: (symbol: string) => void | Promise<void>;
  label?: string;
  error?: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [locking, setLocking] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2 || selected?.symbol === trimmed.toUpperCase()) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void (async () => {
        setLoading(true);
        setMessage("");
        try {
          const response = await fetch(`/api/assets/search?q=${encodeURIComponent(trimmed)}`, {
            signal: controller.signal,
          });
          const body = await response.json() as { error?: string; results: SearchResult[] };
          if (!response.ok) throw new Error(body.error ?? "Search failed");
          setResults(body.results);
          setExpanded(null);
        } catch (cause) {
          if (!controller.signal.aborted) setMessage((cause as Error).message);
        } finally {
          if (!controller.signal.aborted) setLoading(false);
        }
      })();
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, selected?.symbol]);

  async function choose(result: Listing) {
    setQuery(result.symbol);
    setResults([]);
    setSelected(null);
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch(`/api/assets/preview?symbol=${encodeURIComponent(result.symbol)}`);
      const body = await response.json() as Preview & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not load this ticker");
      setSelected(body);
    } catch (cause) {
      setMessage((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function lockPick() {
    if (!selected) return;
    setLocking(true);
    await onConfirm(selected.symbol);
    setLocking(false);
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900">
      {label && <p className="mb-3 text-sm font-bold text-gray-700 dark:text-gray-200">{label}</p>}
      <div className="relative">
        <div className="flex items-center gap-3 rounded-xl border border-gray-300 bg-gray-50 px-4 py-3 transition focus-within:border-indigo-500 focus-within:ring-4 focus-within:ring-indigo-500/10 dark:border-gray-700 dark:bg-gray-950">
          <span aria-hidden="true" className="text-gray-400">⌕</span>
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(null);
              setResults([]);
              setMessage("");
            }}
            placeholder="Search company or ticker…"
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-gray-400"
            autoFocus
            autoComplete="off"
          />
          {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-indigo-500" aria-label="Searching" />}
        </div>

        {results.length > 0 && (
          <div className="absolute z-30 mt-2 max-h-80 w-full overflow-y-auto rounded-xl border border-gray-200 bg-white p-1 shadow-2xl dark:border-gray-700 dark:bg-gray-900">
            {results.map((result) => (
              <div key={`${result.symbol}-${result.exchange}`}>
                <button
                  type="button"
                  onClick={() => void choose(result)}
                  className="flex w-full items-center gap-3 rounded-lg p-2.5 text-left transition hover:bg-indigo-50 dark:hover:bg-indigo-950/40"
                >
                  <AssetLogo src={result.logoUrl} symbol={result.symbol} name={result.name} size={40} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{result.name}</span>
                    <span className="block text-xs text-gray-500">{result.symbol} · {result.exchange || result.type}</span>
                  </span>
                  <span className="rounded-full bg-gray-100 px-2 py-1 text-[10px] font-semibold uppercase text-gray-500 dark:bg-gray-800">
                    {result.type}
                  </span>
                </button>
                {result.alternatives.length > 0 && (
                  <>
                    <button
                      type="button"
                      aria-expanded={expanded === result.symbol}
                      onClick={() => setExpanded((current) => current === result.symbol ? null : result.symbol)}
                      className="ml-14 mb-1 rounded-md px-2 py-1 text-xs font-semibold text-indigo-600 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950/40"
                    >
                      {result.alternatives.length} other {result.alternatives.length === 1 ? "listing" : "listings"}
                      <span aria-hidden="true"> {expanded === result.symbol ? "▴" : "▾"}</span>
                    </button>
                    {expanded === result.symbol && result.alternatives.map((listing) => (
                      <button
                        key={`${listing.symbol}-${listing.exchange}`}
                        type="button"
                        onClick={() => void choose(listing)}
                        className="ml-10 flex w-[calc(100%_-_2.5rem)] items-center gap-3 rounded-lg border-l-2 border-indigo-100 p-2 text-left transition hover:bg-indigo-50 dark:border-indigo-900 dark:hover:bg-indigo-950/40"
                      >
                        <AssetLogo src={listing.logoUrl} symbol={listing.symbol} name={listing.name} size={32} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">{listing.name}</span>
                          <span className="block text-xs text-gray-500">{listing.symbol} · {listing.exchange || listing.type}</span>
                        </span>
                      </button>
                    ))}
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <div className="mt-4 flex flex-wrap items-center gap-4 rounded-xl border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-900 dark:bg-indigo-950/30">
          <AssetLogo src={selected.logoUrl} symbol={selected.symbol} name={selected.name} size={64} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <strong className="font-mono text-lg">{selected.symbol}</strong>
              <span className="rounded-full bg-white px-2 py-0.5 text-xs uppercase text-gray-500 dark:bg-gray-900">{selected.type}</span>
            </div>
            <p className="truncate font-semibold">{selected.name}</p>
            <p className="text-sm text-gray-500">{selected.exchange || "Yahoo Finance"} · {selected.currency}</p>
          </div>
          <div className="text-right">
            <p className="font-mono text-xl font-black">{selected.price.toLocaleString(undefined, { maximumFractionDigits: 4 })}</p>
            <p className="text-xs text-gray-500">Current quote</p>
          </div>
          <button
            type="button"
            disabled={locking}
            onClick={() => void lockPick()}
            className="w-full rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-3 font-bold text-white shadow-lg shadow-indigo-500/20 transition hover:-translate-y-0.5 hover:shadow-xl disabled:opacity-50 sm:w-auto"
          >
            {locking ? "Locking…" : `Lock ${selected.symbol}`}
          </button>
        </div>
      )}

      {(message || error) && <p className="mt-3 text-sm text-red-600">{error || message}</p>}
      {!selected && !message && query.length < 2 && (
        <p className="mt-2 text-xs text-gray-500">Search by company name or Yahoo Finance ticker.</p>
      )}
    </section>
  );
}
