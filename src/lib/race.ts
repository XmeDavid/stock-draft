import { prisma } from "@/lib/db";

export async function getRace() {
  return prisma.race.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
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
