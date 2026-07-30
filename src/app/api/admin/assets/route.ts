import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  return NextResponse.json(await prisma.asset.findMany({ orderBy: { symbol: "asc" } }));
}
