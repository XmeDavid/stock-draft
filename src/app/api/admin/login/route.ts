import { NextResponse } from "next/server";
import { signSession, SESSION_COOKIE } from "@/lib/session";

const attempts = new Map<string, { count: number; ts: number }>();

export async function POST(req: Request) {
  // Last hop only: earlier entries are client-supplied and trivially spoofed.
  const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",").pop()!.trim();
  const a = attempts.get(ip) ?? { count: 0, ts: Date.now() };
  if (Date.now() - a.ts > 15 * 60_000) { a.count = 0; a.ts = Date.now(); }
  if (a.count >= 10) return NextResponse.json({ error: "Too many attempts" }, { status: 429 });

  const { password } = await req.json() as { password?: unknown };
  if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD) {
    a.count++; attempts.set(ip, a);
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, signSession(process.env.SESSION_SECRET!), {
    httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
