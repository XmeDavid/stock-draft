import { NextResponse } from "next/server";
import { chooseMvp } from "@/lib/mvp";

export async function POST(req: Request) {
  try {
    const { playerId, symbol } = await req.json() as { playerId?: unknown; symbol?: unknown };
    if (!Number.isInteger(playerId) || typeof symbol !== "string") {
      return NextResponse.json({ error: "playerId and symbol are required" }, { status: 400 });
    }
    return NextResponse.json(await chooseMvp({ playerId: playerId as number, symbol }));
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
