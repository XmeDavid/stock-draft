import { prisma } from "@/lib/db";

export async function getRace() {
  return prisma.race.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}

export async function assertSetup() {
  const race = await getRace();
  if (race.status !== "setup") {
    const err = new Error("Race already started — configuration is locked");
    (err as Error & { status?: number }).status = 409;
    throw err;
  }
  return race;
}
