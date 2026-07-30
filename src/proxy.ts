import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isLogin = pathname === "/admin/login" || pathname === "/api/admin/login";
  if (isLogin) return NextResponse.next();

  const ok = verifySession(
    req.cookies.get(SESSION_COOKIE)?.value,
    process.env.SESSION_SECRET ?? ""
  );
  if (ok) return NextResponse.next();

  if (pathname.startsWith("/api/"))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.redirect(new URL("/admin/login", req.url));
}

export const config = { matcher: ["/admin/:path*", "/admin", "/api/admin/:path*"] };
