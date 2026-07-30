import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { players } from "@db/schema";
import { getDb } from "@/lib/db";
import { assertPhase } from "@/lib/race";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await assertPhase("registration");
    const { id } = await params;
    await getDb().delete(players).where(eq(players.id, Number(id)));
    return NextResponse.json({ ok: true });
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
