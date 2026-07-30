import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { assertSetup } from "@/lib/race";

export async function GET(req: Request) {
  const playerId = new URL(req.url).searchParams.get("playerId");
  const positions = await prisma.position.findMany({
    where: playerId ? { playerId: Number(playerId) } : undefined,
    include: { asset: true },
    orderBy: { id: "asc" },
  });
  return NextResponse.json(positions);
}

export async function PUT(req: Request) {
  try {
    const race = await assertSetup();
    const { playerId, positions } = await req.json() as
      { playerId: number; positions: { assetId: number; allocation: number }[] };
    const total = positions.reduce((s, p) => s + p.allocation, 0);
    if (total > Number(race.startingCapital) + 0.01)
      return NextResponse.json(
        { error: `Allocations (${total}) exceed starting capital (${race.startingCapital})` },
        { status: 400 });
    await prisma.$transaction([
      prisma.position.deleteMany({ where: { playerId } }),
      prisma.position.createMany({
        data: positions.filter((p) => p.allocation > 0)
          .map((p) => ({ playerId, assetId: p.assetId, allocation: p.allocation })),
      }),
    ]);
    const saved = await prisma.position.findMany({ where: { playerId }, include: { asset: true } });
    return NextResponse.json(saved);
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
