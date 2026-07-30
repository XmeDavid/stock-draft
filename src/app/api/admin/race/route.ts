import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { assertPhase } from "@/lib/race";

export async function PUT(req: Request) {
  try {
    await assertPhase("registration");
    const { inviteCode, name, currency } = await req.json();
    const data: { inviteCode?: string; name?: string; currency?: string } = {};

    if (inviteCode !== undefined) {
      if (typeof inviteCode !== "string")
        return NextResponse.json({ error: "inviteCode must be a string" }, { status: 400 });
      data.inviteCode = inviteCode.trim();
    }
    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim())
        return NextResponse.json({ error: "name must be a non-empty string" }, { status: 400 });
      data.name = name.trim();
    }
    if (currency !== undefined) {
      const code = typeof currency === "string" ? currency.trim().toUpperCase() : "";
      if (!/^[A-Z]{3}$/.test(code))
        return NextResponse.json({ error: "currency must be a 3-letter code" }, { status: 400 });
      data.currency = code;
    }

    const race = await prisma.race.update({ where: { id: 1 }, data });
    return NextResponse.json({
      name: race.name,
      currency: race.currency,
      inviteCode: race.inviteCode,
      status: race.status,
    });
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
