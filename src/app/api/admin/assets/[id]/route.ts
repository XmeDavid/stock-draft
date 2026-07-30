import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { assertPhase } from "@/lib/race";
import { TYPES, SOURCES } from "@/lib/assets";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await assertPhase("registration");
    const { id } = await params;
    const { symbol, name, type, priceSource, sourceId, quoteCurrency } = await req.json();
    if (type !== undefined && !TYPES.includes(type))
      return NextResponse.json({ error: `type must be one of ${TYPES.join(", ")}` }, { status: 400 });
    if (priceSource !== undefined && !SOURCES.includes(priceSource))
      return NextResponse.json({ error: `priceSource must be one of ${SOURCES.join(", ")}` }, { status: 400 });
    const asset = await prisma.asset.update({
      where: { id: Number(id) },
      data: { symbol, name, type, priceSource, sourceId, quoteCurrency },
    });
    return NextResponse.json(asset);
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await assertPhase("registration");
    const { id } = await params;
    await prisma.asset.delete({ where: { id: Number(id) } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
