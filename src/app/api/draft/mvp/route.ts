import { type NextRequest, NextResponse } from "next/server";
import { chooseMvp } from "@/lib/mvp";
import { PLAYER_COOKIE, playerIdFromCookie } from "@/lib/playerSession";

export async function POST(req: NextRequest) {
  try {
    const playerId = playerIdFromCookie(req.cookies.get(PLAYER_COOKIE)?.value);
    if (playerId === null) {
      return NextResponse.json({ error: "Log in to choose your MVP" }, { status: 401 });
    }
    const body = await req.json() as { symbol?: unknown };
    if (typeof body.symbol !== "string") {
      return NextResponse.json({ error: "symbol must be a string" }, { status: 400 });
    }
    return NextResponse.json(await chooseMvp({ playerId, symbol: body.symbol }));
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
