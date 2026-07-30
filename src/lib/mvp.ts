import { and, eq, isNotNull } from "drizzle-orm";
import { assets, positions } from "@db/schema";
import { getDb } from "@/lib/db";
import { getRace } from "@/lib/race";

function httpError(message: string, status: number): Error {
  const error = new Error(message);
  (error as Error & { status?: number }).status = status;
  return error;
}

export async function chooseMvp(input: { playerId: number; symbol: string }): Promise<{ symbol: string }> {
  const symbol = input.symbol.trim().toUpperCase();
  if (!symbol) throw httpError("Choose one of your drafted tickers", 400);

  const race = await getRace();
  if (race.status !== "drafted") {
    throw httpError(`MVP selection is closed (status: ${race.status})`, 409);
  }

  const db = getDb();
  const [existing] = await db
    .select({ symbol: assets.symbol })
    .from(positions)
    .innerJoin(assets, eq(positions.assetId, assets.id))
    .where(and(eq(positions.playerId, input.playerId), eq(positions.isMvp, true)))
    .limit(1);
  if (existing) throw httpError(`Your MVP is already locked: ${existing.symbol}`, 409);

  const [position] = await db
    .select({ id: positions.id })
    .from(positions)
    .innerJoin(assets, eq(positions.assetId, assets.id))
    .where(and(
      eq(positions.playerId, input.playerId),
      isNotNull(positions.pickIndex),
      eq(assets.symbol, symbol),
    ))
    .limit(1);
  if (!position) throw httpError(`${symbol} is not one of your drafted picks`, 400);

  const updated = await db.update(positions)
    .set({ isMvp: true })
    .where(and(eq(positions.id, position.id), eq(positions.isMvp, false)))
    .returning({ id: positions.id });
  if (updated.length === 0) throw httpError("Your MVP was already locked by another request", 409);
  return { symbol };
}
