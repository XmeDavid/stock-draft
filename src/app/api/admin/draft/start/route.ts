import { NextResponse } from "next/server";
import { startDraft } from "@/lib/draft";

export async function POST() {
  try {
    return NextResponse.json(await startDraft());
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
