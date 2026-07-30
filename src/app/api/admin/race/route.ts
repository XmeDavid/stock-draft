import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { races } from "@db/schema";
import { getDb } from "@/lib/db";
import { getRace } from "@/lib/race";

export async function GET() {
  const race = await getRace();
  return NextResponse.json({
    name: race.name,
    currency: race.currency,
    inviteCode: race.inviteCode,
    status: race.status,
    endAt: race.endAt?.toISOString() ?? null,
  });
}

export async function PUT(req: Request) {
  try {
    const current = await getRace();
    const { inviteCode, name, currency, endAt } = await req.json() as {
      inviteCode?: unknown;
      name?: unknown;
      currency?: unknown;
      endAt?: unknown;
    };
    const data: { inviteCode?: string; name?: string; currency?: string; endAt?: Date } = {};

    if (
      current.status !== "registration" &&
      (inviteCode !== undefined || name !== undefined || currency !== undefined)
    ) {
      return NextResponse.json({ error: "Name, currency, and invite code lock when the draft starts" }, { status: 409 });
    }
    if (!["registration", "drafting", "drafted", "running"].includes(current.status)) {
      return NextResponse.json({ error: `Race settings are locked (status: ${current.status})` }, { status: 409 });
    }

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
    if (endAt !== undefined) {
      if (typeof endAt !== "string") {
        return NextResponse.json({ error: "endAt must be a date string" }, { status: 400 });
      }
      const date = new Date(endAt);
      if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
        return NextResponse.json({ error: "End date must be in the future" }, { status: 400 });
      }
      data.endAt = date;
    }

    const [race] = await getDb().update(races).set(data).where(eq(races.id, 1)).returning();
    if (!race) throw new Error("Race was not found");
    return NextResponse.json({
      name: race.name,
      currency: race.currency,
      inviteCode: race.inviteCode,
      status: race.status,
      endAt: race.endAt?.toISOString() ?? null,
    });
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
