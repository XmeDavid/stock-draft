import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { races } from "@db/schema";
import { getDb } from "@/lib/db";
import { assertPhase } from "@/lib/race";

export async function POST(req: Request) {
  try {
    const raceState = await assertPhase("registration", "drafting", "drafted");
    const { startAt } = await req.json() as { startAt?: unknown };

    let scheduledStartAt: Date | null = null;
    if (startAt !== null && startAt !== undefined) {
      if (typeof startAt !== "string")
        return NextResponse.json({ error: "startAt must be a date string or null" }, { status: 400 });
      const when = new Date(startAt);
      if (Number.isNaN(when.getTime()))
        return NextResponse.json({ error: "startAt is not a valid date" }, { status: 400 });
      if (when.getTime() <= Date.now())
        return NextResponse.json({ error: "startAt must be in the future" }, { status: 400 });
      if (raceState.endAt && when >= raceState.endAt)
        return NextResponse.json({ error: "startAt must be before the race end date" }, { status: 400 });
      scheduledStartAt = when;
    }

    const [race] = await getDb().update(races)
      .set({ scheduledStartAt })
      .where(eq(races.id, 1))
      .returning();
    if (!race) throw new Error("Race was not found");
    return NextResponse.json({ scheduledStartAt: race.scheduledStartAt?.toISOString() ?? null });
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
