import { NextResponse } from "next/server";
import { startRace } from "@/lib/startRace";

export async function POST() {
  try {
    await startRace();
    return NextResponse.json({ ok: true });
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
