import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(req: Request) {
  const playerId = new URL(req.url).searchParams.get("playerId");
  const positions = await prisma.position.findMany({
    where: playerId ? { playerId: Number(playerId) } : undefined,
    include: { asset: true },
    orderBy: { id: "asc" },
  });
  return NextResponse.json(positions);
}

