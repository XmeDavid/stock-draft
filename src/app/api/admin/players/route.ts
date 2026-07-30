import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { assertSetup } from "@/lib/race";

export async function GET() {
  const players = await prisma.player.findMany({
    include: { positions: { include: { asset: true } } },
    orderBy: { id: "asc" },
  });
  return NextResponse.json(players);
}

export async function POST(req: Request) {
  try {
    await assertSetup();
    const { name, strategy = "", color = "#8884d8" } = await req.json();
    if (!name?.trim()) return NextResponse.json({ error: "Name required" }, { status: 400 });
    const player = await prisma.player.create({ data: { name: name.trim(), strategy, color } });
    return NextResponse.json(player, { status: 201 });
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
