import { NextResponse } from "next/server";
import { makePick } from "@/lib/draft";

export async function POST(req: Request) {
  try {
    const { symbol } = await req.json() as { symbol?: unknown };
    if (typeof symbol !== "string" || !symbol.trim())
      return NextResponse.json({ error: "symbol required" }, { status: 400 });
    const result = await makePick({ actorPlayerId: "admin", symbol: symbol.trim() });
    return NextResponse.json(result);
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
