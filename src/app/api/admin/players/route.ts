import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const players = await prisma.player.findMany({
    include: { positions: { include: { asset: true } } },
    orderBy: { id: "asc" },
  });
  return NextResponse.json(players);
}
