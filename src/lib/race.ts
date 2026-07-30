import { eq } from "drizzle-orm";
import { races } from "@db/schema";
import { getDb } from "@/lib/db";

export async function getRace() {
  const db = getDb();
  await db.insert(races).values({ id: 1 }).onConflictDoNothing();
  const [race] = await db.select().from(races).where(eq(races.id, 1)).limit(1);
  if (!race) throw new Error("Race could not be initialized");
  return race;
}

export async function assertPhase(...phases: string[]) {
  const race = await getRace();
  if (!phases.includes(race.status)) {
    const err = new Error(
      `Not allowed in phase "${race.status}" (requires ${phases.join(" or ")})`
    );
    (err as Error & { status?: number }).status = 409;
    throw err;
  }
  return race;
}
