import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { assertPhase } from "@/lib/race";
import { getPrice } from "@/lib/prices";
import { TYPES, SOURCES } from "@/lib/assets";

export async function GET() {
  return NextResponse.json(await prisma.asset.findMany({ orderBy: { symbol: "asc" } }));
}

export async function POST(req: Request) {
  try {
    const race = await assertPhase("registration");
    const { symbol, name, type, priceSource, sourceId = "", quoteCurrency = race.currency } = await req.json();
    if (!symbol?.trim() || !name?.trim()) return NextResponse.json({ error: "Symbol and name required" }, { status: 400 });
    if (!TYPES.includes(type)) return NextResponse.json({ error: `type must be one of ${TYPES.join(", ")}` }, { status: 400 });
    if (!SOURCES.includes(priceSource)) return NextResponse.json({ error: `priceSource must be one of ${SOURCES.join(", ")}` }, { status: 400 });
    if (priceSource !== "none") {
      try {
        await getPrice({ priceSource, sourceId, quoteCurrency, type }, race.currency);
      } catch (e) {
        return NextResponse.json({ error: `Price check failed: ${(e as Error).message}` }, { status: 400 });
      }
    }
    const asset = await prisma.asset.create({
      data: { symbol: symbol.trim().toUpperCase(), name: name.trim(), type, priceSource, sourceId, quoteCurrency },
    });
    return NextResponse.json(asset, { status: 201 });
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
