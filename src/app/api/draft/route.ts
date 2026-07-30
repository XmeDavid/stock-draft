import { type NextRequest, NextResponse } from "next/server";
import { asc, eq, isNotNull } from "drizzle-orm";
import { assets, players, positions } from "@db/schema";
import { getDb } from "@/lib/db";
import { getRace } from "@/lib/race";
import { advanceRaceClock } from "@/lib/raceClock";
import { turnFor } from "@/lib/draftOrder";
import { PLAYER_COOKIE, playerIdFromCookie } from "@/lib/playerSession";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import { logoUrlForSymbol } from "@/lib/logos";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  await advanceRaceClock();
  const race = await getRace();
  const db = getDb();
  const playerRows = await db
    .select({
      id: players.id,
      name: players.name,
      username: players.username,
      strategy: players.strategy,
      color: players.color,
    })
    .from(players)
    .orderBy(asc(players.id));

  const raw = Array.isArray(race.draftOrder) ? race.draftOrder : [];
  const order = raw.map(Number).filter((id) => Number.isFinite(id));

  const currentPlayerId =
    race.status === "drafting" && order.length > 0
      ? turnFor(order, race.currentPickIndex)
      : null;

  const cookiePlayerId = playerIdFromCookie(req.cookies.get(PLAYER_COOKIE)?.value);
  const yourPlayerId = cookiePlayerId !== null && playerRows.some((player) => player.id === cookiePlayerId)
    ? cookiePlayerId
    : null;
  const isAdmin = verifySession(
    req.cookies.get(SESSION_COOKIE)?.value,
    process.env.SESSION_SECRET ?? ""
  );

  const positionRows = await db
    .select({ position: positions, asset: assets })
    .from(positions)
    .innerJoin(assets, eq(positions.assetId, assets.id))
    .where(isNotNull(positions.pickIndex))
    .orderBy(asc(positions.pickIndex));
  const mvpPositions = positionRows.filter((row) => row.position.isMvp);
  const mvpRevealed = playerRows.length > 0 && mvpPositions.length === playerRows.length;
  const yourMvp = mvpPositions.find((row) => row.position.playerId === yourPlayerId);

  return NextResponse.json({
    raceName: race.name,
    currency: race.currency,
    status: race.status,
    roster: playerRows,
    order,
    currentPickIndex: race.currentPickIndex,
    currentPlayerId,
    yourPlayerId,
    yourTurn: yourPlayerId !== null && yourPlayerId === currentPlayerId,
    picksPerPlayer: race.picksPerPlayer,
    perPickAmount: Number(race.perPickAmount),
    scheduledStartAt: race.scheduledStartAt?.toISOString() ?? null,
    endAt: race.endAt?.toISOString() ?? null,
    mvpLockedCount: mvpPositions.length,
    mvpPlayerIds: isAdmin ? mvpPositions.map((row) => row.position.playerId) : [],
    mvpRevealed,
    yourMvpSymbol: yourMvp?.asset.symbol ?? null,
    picks: positionRows.map(({ position, asset }) => ({
      pickIndex: position.pickIndex as number,
      playerId: position.playerId,
      symbol: asset.symbol,
      name: asset.name,
      type: asset.type,
      logoUrl: logoUrlForSymbol(asset.symbol),
      isMvp: mvpRevealed ? position.isMvp : position.playerId === yourPlayerId && position.isMvp,
    })),
  });
}
