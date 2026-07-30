import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { players } from "@db/schema";
import { getDb } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { signToken } from "@/lib/session";
import { PLAYER_COOKIE } from "@/lib/playerSession";

const attempts = new Map<string, { count: number; ts: number }>();

export async function POST(req: Request) {
  // Last hop only: earlier entries are client-supplied and trivially spoofed.
  const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",").pop()!.trim();
  const a = attempts.get(ip) ?? { count: 0, ts: Date.now() };
  if (Date.now() - a.ts > 15 * 60_000) { a.count = 0; a.ts = Date.now(); }
  if (a.count >= 10) return NextResponse.json({ error: "Too many attempts" }, { status: 429 });

  try {
    const { username, password } = await req.json() as { username?: unknown; password?: unknown };
    const user = typeof username === "string" ? username.trim() : "";
    const [player] = user
      ? await getDb().select().from(players).where(eq(players.username, user)).limit(1)
      : [];

    if (!player || typeof password !== "string" || !verifyPassword(password, player.passwordHash)) {
      a.count++; attempts.set(ip, a);
      return NextResponse.json({ error: "Wrong username or password" }, { status: 401 });
    }

    const res = NextResponse.json({ id: player.id, username: player.username, name: player.name });
    res.cookies.set(PLAYER_COOKIE, signToken({ playerId: player.id }, process.env.SESSION_SECRET ?? ""), {
      httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30,
    });
    return res;
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
