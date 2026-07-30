import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getRace } from "@/lib/race";
import { turnFor } from "@/lib/draft";
import { PLAYER_COOKIE, playerIdFromCookie } from "@/lib/playerSession";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const race = await getRace();
  const players = await prisma.player.findMany({
    select: { id: true, name: true, username: true, color: true },
    orderBy: { id: "asc" },
  });

  const raw = Array.isArray(race.draftOrder) ? race.draftOrder : [];
  const order = raw.map(Number).filter((id) => Number.isFinite(id));

  const currentPlayerId =
    race.status === "drafting" && order.length > 0
      ? turnFor(order, race.currentPickIndex)
      : null;

  const yourPlayerId = playerIdFromCookie(req.cookies.get(PLAYER_COOKIE)?.value);

  const positions = await prisma.position.findMany({
    where: { pickIndex: { not: null } },
    include: { asset: { select: { symbol: true, name: true } } },
    orderBy: { pickIndex: "asc" },
  });

  return NextResponse.json({
    status: race.status,
    roster: players,
    order,
    currentPickIndex: race.currentPickIndex,
    currentPlayerId,
    yourPlayerId,
    yourTurn: yourPlayerId !== null && yourPlayerId === currentPlayerId,
    picksPerPlayer: race.picksPerPlayer,
    perPickAmount: Number(race.perPickAmount),
    scheduledStartAt: race.scheduledStartAt?.toISOString() ?? null,
    picks: positions.map((p) => ({
      pickIndex: p.pickIndex as number,
      playerId: p.playerId,
      symbol: p.asset.symbol,
      name: p.asset.name,
    })),
  });
}
