import { type NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { players } from "@db/schema";
import { getDb } from "@/lib/db";
import { PLAYER_COOKIE, playerIdFromCookie } from "@/lib/playerSession";

const MAX_STRATEGY_LENGTH = 160;

export async function PUT(req: NextRequest) {
  const playerId = playerIdFromCookie(req.cookies.get(PLAYER_COOKIE)?.value);
  if (playerId === null) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  try {
    const { strategy } = await req.json() as { strategy?: unknown };
    if (typeof strategy !== "string") {
      return NextResponse.json({ error: "strategy must be a string" }, { status: 400 });
    }

    const value = strategy.trim();
    if (value.length > MAX_STRATEGY_LENGTH) {
      return NextResponse.json(
        { error: `Strategy must be ${MAX_STRATEGY_LENGTH} characters or fewer` },
        { status: 400 }
      );
    }

    const [player] = await getDb()
      .update(players)
      .set({ strategy: value })
      .where(eq(players.id, playerId))
      .returning({ id: players.id, strategy: players.strategy });
    if (!player) {
      return NextResponse.json({ error: "Player was not found" }, { status: 404 });
    }

    return NextResponse.json(player);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
