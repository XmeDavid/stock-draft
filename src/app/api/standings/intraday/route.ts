import { NextResponse } from "next/server";
import { getIntradayHistory, type IntradayRange } from "@/lib/intraday";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const range = new URL(req.url).searchParams.get("range");
  if (range !== "1d" && range !== "1w") {
    return NextResponse.json({ error: "range must be 1d or 1w" }, { status: 400 });
  }
  try {
    return NextResponse.json(await getIntradayHistory(range as IntradayRange));
  } catch (error) {
    const status = (error as Error & { status?: number }).status ?? 502;
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}
