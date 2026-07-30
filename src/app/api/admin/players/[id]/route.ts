import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { assertPhase } from "@/lib/race";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await assertPhase("registration");
    const { id } = await params;
    const { name, strategy, color } = await req.json();
    const player = await prisma.player.update({
      where: { id: Number(id) },
      data: { name, strategy, color },
    });
    return NextResponse.json(player);
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await assertPhase("registration");
    const { id } = await params;
    await prisma.player.delete({ where: { id: Number(id) } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
