/**
 * In-process quote caches (standings prices, intraday series). Each entry is
 * tagged with the corporate-action log revision it was built against, so a
 * split or deal recorded on another instance still invalidates it, and
 * `clearQuoteCaches` drops everything on this instance right after a write.
 */
type Entry = { at: number; revision: number; value: unknown };

const cacheGlobal = globalThis as typeof globalThis & { quoteCaches?: Map<string, Entry> };

function store(): Map<string, Entry> {
  return cacheGlobal.quoteCaches ??= new Map();
}

export function readQuoteCache<T>(key: string, revision: number, ttlMs: number): { at: number; value: T } | null {
  const entry = store().get(key);
  if (!entry || entry.revision !== revision || Date.now() - entry.at >= ttlMs) return null;
  return { at: entry.at, value: entry.value as T };
}

export function writeQuoteCache<T>(key: string, revision: number, value: T): number {
  const at = Date.now();
  store().set(key, { at, revision, value });
  return at;
}

export function clearQuoteCaches(): void {
  store().clear();
}
