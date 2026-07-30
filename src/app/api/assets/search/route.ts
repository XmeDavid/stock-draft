import { NextResponse } from "next/server";
import { logoUrlForSymbol } from "@/lib/logos";
import { searchTickers } from "@/lib/prices";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const query = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 2) return NextResponse.json({ results: [] });
  if (query.length > 50) {
    return NextResponse.json({ error: "Search is too long" }, { status: 400 });
  }
  try {
    const results = (await searchTickers(query)).map((result) => ({
      ...result,
      logoUrl: logoUrlForSymbol(result.symbol),
    }));
    return NextResponse.json({ results });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
