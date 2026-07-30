import { NextResponse } from "next/server";
import { count } from "drizzle-orm";
import { players } from "@db/schema";
import { getDb } from "@/lib/db";
import { assertPhase } from "@/lib/race";
import { hashPassword } from "@/lib/password";
import { signToken } from "@/lib/session";
import { PLAYER_COOKIE } from "@/lib/playerSession";

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,20}$/;

// Visually distinct chart colours, handed out round-robin by join order.
const PALETTE = [
  "#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4",
  "#46f0f0", "#f032e6", "#bcf60c", "#fabebe", "#008080",
];

export async function POST(req: Request) {
  try {
    const race = await assertPhase("registration");
    const { inviteCode, username, password, name } = await req.json() as {
      inviteCode?: unknown;
      username?: unknown;
      password?: unknown;
      name?: unknown;
    };

    if (!race.inviteCode || inviteCode !== race.inviteCode) {
      return NextResponse.json({ error: "Invalid invite code" }, { status: 403 });
    }

    const user = typeof username === "string" ? username.trim() : "";
    if (!USERNAME_RE.test(user)) {
      return NextResponse.json(
        { error: "Username must be 3-20 characters (letters, digits, _ . -)" },
        { status: 400 }
      );
    }
    if (typeof password !== "string" || password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }

    const displayName = typeof name === "string" && name.trim() ? name.trim() : user;
    const db = getDb();
    const [{ value: playerCount }] = await db.select({ value: count() }).from(players);
    const color = PALETTE[playerCount % PALETTE.length];
    const [player] = await db.insert(players).values({
      name: displayName,
      username: user,
      passwordHash: hashPassword(password),
      color,
    }).returning();
    if (!player) throw new Error("Player could not be created");

    const res = NextResponse.json(
      { id: player.id, username: player.username, name: player.name },
      { status: 201 }
    );
    res.cookies.set(PLAYER_COOKIE, signToken({ playerId: player.id }, process.env.SESSION_SECRET ?? ""), {
      httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30,
    });
    return res;
  } catch (e) {
    const databaseCode = (e as { cause?: { code?: string } }).cause?.code;
    if (databaseCode === "23505") {
      return NextResponse.json({ error: "Username already taken" }, { status: 409 });
    }
    const status = (e as { status?: number }).status ?? 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
