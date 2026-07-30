import { desc } from "drizzle-orm";
import { snapshots } from "@db/schema";
import { getDb } from "@/lib/db";
import { finishRace } from "@/lib/finishRace";
import { getRace } from "@/lib/race";
import { runSnapshot } from "@/lib/snapshot";
import { startRace } from "@/lib/startRace";

/**
 * The first visitor after a scheduled boundary advances the clock and records
 * any due daily snapshot, so deployment restarts cannot lose a race event.
 */
export async function advanceRaceClock(now = new Date()) {
  let race = await getRace();
  if (race.status === "drafted" && race.scheduledStartAt && now >= race.scheduledStartAt) {
    await startRace({ now });
    race = await getRace();
  }
  if (race.status !== "running") return;
  if (race.endAt && now >= race.endAt) {
    await finishRace({ now });
    return;
  }

  const snapshotHour = Number(process.env.SNAPSHOT_HOUR ?? 18);
  const cutoff = new Date(now);
  cutoff.setUTCHours(snapshotHour, 0, 0, 0);
  if (now < cutoff) return;
  const [latest] = await getDb()
    .select({ capturedAt: snapshots.capturedAt })
    .from(snapshots)
    .orderBy(desc(snapshots.capturedAt))
    .limit(1);
  if (!latest || latest.capturedAt < cutoff) await runSnapshot({ now });
}
