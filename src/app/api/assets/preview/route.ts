import { NextResponse } from "next/server";
import { logoUrlForSymbol } from "@/lib/logos";
import { resolveTicker } from "@/lib/prices";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const symbol = new URL(req.url).searchParams.get("symbol")?.trim() ?? "";
  if (!symbol || symbol.length > 30) {
    return NextResponse.json({ error: "Choose a valid ticker" }, { status: 400 });
  }
  try {
    const asset = await resolveTicker(symbol);
    return NextResponse.json({ ...asset, logoUrl: logoUrlForSymbol(asset.symbol) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
