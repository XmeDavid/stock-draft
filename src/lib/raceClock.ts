import { desc } from "drizzle-orm";
import { snapshots } from "@db/schema";
import { getDb } from "@/lib/db";
import { finishRace } from "@/lib/finishRace";
import { getRace } from "@/lib/race";
import { runSnapshot } from "@/lib/snapshot";
import { startRace } from "@/lib/startRace";

/** UTC hours (0-23) at which a daily snapshot is due; last one of the day is canonical. */
export function parseSnapshotHours(raw: string | undefined): number[] {
  const hours = [...new Set(
    (raw ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value !== "")
      .map(Number)
      .filter((hour) => Number.isInteger(hour) && hour >= 0 && hour <= 23)
  )].sort((a, b) => a - b);
  return hours.length > 0 ? hours : [18];
}

/** The most recent snapshot deadline at or before `now` (yesterday's last hour if none has passed today). */
export function latestSnapshotCutoff(now: Date, hours: number[]): Date {
  const at = (dayOffset: number, hour: number) => {
    const cutoff = new Date(now);
    cutoff.setUTCDate(cutoff.getUTCDate() + dayOffset);
    cutoff.setUTCHours(hour, 0, 0, 0);
    return cutoff;
  };
  const passedToday = hours.map((hour) => at(0, hour)).filter((cutoff) => cutoff <= now);
  return passedToday.at(-1) ?? at(-1, hours.at(-1)!);
}

const tickerGlobal = globalThis as typeof globalThis & {
  raceClockTicker?: ReturnType<typeof setInterval>;
};

/** Keeps race events on schedule with zero traffic; per-request triggering stays as a fallback. */
export function startRaceClockTicker(intervalMs = 10 * 60_000) {
  if (tickerGlobal.raceClockTicker) return;
  const timer = setInterval(() => {
    advanceRaceClock().catch((error) => console.error("race clock tick failed:", error));
  }, intervalMs);
  timer.unref?.();
  tickerGlobal.raceClockTicker = timer;
}

/**
 * The first visitor after a scheduled boundary advances the clock and records
 * any due daily snapshot, so deployment restarts cannot lose a race event.
 */
export async function advanceRaceClock(now = new Date()) {
  let race = await getRace();
  if (race.status === "drafted" && race.scheduledStartAt && now >= race.scheduledStartAt) {
    try {
      await startRace({ now });
    } catch (error) {
      const status = (error as Error & { status?: number }).status;
      // A scheduled start can arrive before every MVP is locked, or while a
      // quote provider is temporarily unavailable. Keep the site usable and
      // retry on the next request once the race is ready.
      if (status === 409 || status === 502) return;
      throw error;
    }
    race = await getRace();
  }
  if (race.status !== "running") return;
  if (race.endAt && now >= race.endAt) {
    await finishRace({ now });
    return;
  }

  const hours = parseSnapshotHours(process.env.SNAPSHOT_HOURS ?? process.env.SNAPSHOT_HOUR);
  const cutoff = latestSnapshotCutoff(now, hours);
  const [latest] = await getDb()
    .select({ capturedAt: snapshots.capturedAt })
    .from(snapshots)
    .orderBy(desc(snapshots.capturedAt))
    .limit(1);
  if (!latest || latest.capturedAt < cutoff) await runSnapshot({ now });
}
