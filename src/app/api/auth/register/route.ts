import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { assertPhase } from "@/lib/race";
import { hashPassword } from "@/lib/password";
import { signToken } from "@/lib/session";
import { PLAYER_COOKIE } from "@/lib/playerSession";

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,20}$/;

export async function POST(req: Request) {
  try {
    const race = await assertPhase("registration");
    const { inviteCode, username, password, name } = await req.json();

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
    const player = await prisma.player.create({
      data: { name: displayName, username: user, passwordHash: hashPassword(password) },
    });

    const res = NextResponse.json(
      { id: player.id, username: player.username, name: player.name },
      { status: 201 }
    );
    res.cookies.set(PLAYER_COOKIE, signToken({ playerId: player.id }, process.env.SESSION_SECRET ?? ""), {
      httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30,
    });
    return res;
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "Username already taken" }, { status: 409 });
    }
    const status = (e as { status?: number }).status ?? 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
