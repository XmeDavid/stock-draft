import { and, eq } from "drizzle-orm";
import { races } from "@db/schema";
import { getDb } from "@/lib/db";
import { getRace } from "@/lib/race";
import { runSnapshot } from "@/lib/snapshot";

export async function finishRace(
  { snapshot = runSnapshot, now = new Date() }: { snapshot?: typeof runSnapshot; now?: Date } = {}
) {
  const race = await getRace();
  if (race.status !== "running") return { skipped: `race status is ${race.status}` };
  if (!race.endAt || now < race.endAt) return { skipped: "race has not reached its end date" };

  await snapshot({ now });
  const finished = await getDb().update(races)
    .set({ status: "finished", finishedAt: now })
    .where(and(eq(races.id, 1), eq(races.status, "running")))
    .returning({ id: races.id });
  return finished.length === 1 ? { finished: true } : { skipped: "race was already finished" };
}
