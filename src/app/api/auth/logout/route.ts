import { NextResponse } from "next/server";
import { PLAYER_COOKIE } from "@/lib/playerSession";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(PLAYER_COOKIE, "", {
    httpOnly: true, sameSite: "lax", path: "/", maxAge: 0,
  });
  return res;
}
