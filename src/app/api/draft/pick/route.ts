import { type NextRequest, NextResponse } from "next/server";
import { makePick } from "@/lib/draft";
import { PLAYER_COOKIE, playerIdFromCookie } from "@/lib/playerSession";

export async function POST(req: NextRequest) {
  const playerId = playerIdFromCookie(req.cookies.get(PLAYER_COOKIE)?.value);
  if (playerId === null) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  try {
    const { symbol } = await req.json();
    if (typeof symbol !== "string" || !symbol.trim())
      return NextResponse.json({ error: "symbol required" }, { status: 400 });
    const result = await makePick({ actorPlayerId: playerId, symbol: symbol.trim() });
    return NextResponse.json(result);
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
