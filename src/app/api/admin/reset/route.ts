import { NextResponse } from "next/server";
import { assets, players, positions, races, snapshots } from "@db/schema";
import { getDb } from "@/lib/db";
import { isResetConfirmation } from "@/lib/resetConfirmation";

export async function POST(req: Request) {
  try {
    const { confirmation, password } = await req.json() as {
      confirmation?: unknown;
      password?: unknown;
    };

    if (!isResetConfirmation(confirmation)) {
      return NextResponse.json({ error: "The reset confirmation text does not match" }, { status: 400 });
    }
    if (
      !process.env.ADMIN_PASSWORD ||
      typeof password !== "string" ||
      password !== process.env.ADMIN_PASSWORD
    ) {
      return NextResponse.json({ error: "Wrong admin password" }, { status: 403 });
    }

    await getDb().transaction(async (tx) => {
      await tx.delete(snapshots);
      await tx.delete(positions);
      await tx.delete(players);
      await tx.delete(assets);
      await tx.delete(races);
      await tx.insert(races).values({ id: 1 });
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
