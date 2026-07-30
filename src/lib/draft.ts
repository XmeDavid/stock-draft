import { randomInt } from "node:crypto";
import { and, eq, isNotNull } from "drizzle-orm";
import { assets, players, positions, races } from "@db/schema";
import { getDb } from "@/lib/db";
import { getRace } from "@/lib/race";
import { findDraftedIssuer } from "@/lib/issuer";
import { resolveTicker } from "@/lib/prices";
export { turnFor } from "@/lib/draftOrder";
import { turnFor } from "@/lib/draftOrder";

function httpError(message: string, status: number): Error {
  const error = new Error(message);
  (error as Error & { status?: number }).status = status;
  return error;
}

function cryptoShuffle(ids: number[]): number[] {
  const result = [...ids];
  for (let index = result.length - 1; index > 0; index--) {
    const swap = randomInt(index + 1);
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

function readOrder(raw: unknown): number[] {
  if (!Array.isArray(raw)) throw httpError("Draft order is not set", 409);
  const order = raw.map(Number);
  if (order.length === 0 || order.some((id) => !Number.isFinite(id))) {
    throw httpError("Draft order is invalid", 409);
  }
  return order;
}

export async function startDraft(
  { shuffle = cryptoShuffle }: { shuffle?: (ids: number[]) => number[] } = {}
): Promise<{ order: number[] }> {
  const race = await getRace();
  if (race.status !== "registration") {
    throw httpError(`Draft cannot start (status: ${race.status})`, 409);
  }
  const db = getDb();
  const playerRows = await db.select({ id: players.id }).from(players);
  if (playerRows.length < 2) throw httpError("At least 2 players are needed to draft", 409);
  const order = shuffle(playerRows.map((player) => player.id));
  await db.update(races)
    .set({ status: "drafting", draftOrder: order, currentPickIndex: 0 })
    .where(eq(races.id, 1));
  return { order };
}

export async function makePick(
  input: { actorPlayerId: number | "admin"; symbol: string },
  { resolve = resolveTicker }: { resolve?: typeof resolveTicker } = {}
): Promise<{ pickIndex: number; symbol: string; playerId: number; done: boolean }> {
  const pre = await getRace();
  if (pre.status !== "drafting") {
    throw httpError(`Draft is not open (status: ${pre.status})`, 409);
  }
  const preExpected = turnFor(readOrder(pre.draftOrder), pre.currentPickIndex);
  if (input.actorPlayerId !== "admin" && input.actorPlayerId !== preExpected) {
    throw httpError("Not your turn", 403);
  }

  let resolved;
  try {
    resolved = await resolve(input.symbol);
  } catch (error) {
    throw httpError(error instanceof Error ? error.message : String(error), 400);
  }

  const db = getDb();
  const draftedAssets = await db
    .select({ symbol: assets.symbol, name: assets.name, type: assets.type })
    .from(positions)
    .innerJoin(assets, eq(positions.assetId, assets.id))
    .where(isNotNull(positions.pickIndex));
  const taken = findDraftedIssuer(resolved, draftedAssets);
  if (taken) {
    const detail = taken.symbol === resolved.symbol
      ? `${resolved.symbol} already drafted`
      : `${resolved.name} already drafted as ${taken.symbol}`;
    throw httpError(detail, 409);
  }

  await db.insert(assets).values({
    symbol: resolved.symbol,
    name: resolved.name,
    type: resolved.type,
    priceSource: "yahoo",
    sourceId: resolved.symbol,
    quoteCurrency: resolved.currency,
  }).onConflictDoUpdate({
    target: assets.symbol,
    set: { name: resolved.name, type: resolved.type, quoteCurrency: resolved.currency },
  });
  const [asset] = await db.select().from(assets).where(eq(assets.symbol, resolved.symbol)).limit(1);
  if (!asset) throw new Error("Asset could not be saved");

  const race = await getRace();
  if (race.status !== "drafting") throw httpError(`Draft is not open (status: ${race.status})`, 409);
  const order = readOrder(race.draftOrder);
  const pickIndex = race.currentPickIndex;
  const expected = turnFor(order, pickIndex);
  if (input.actorPlayerId !== "admin" && input.actorPlayerId !== expected) {
    throw httpError("Not your turn", 403);
  }

  const [position] = await db.insert(positions).values({
    playerId: expected,
    assetId: asset.id,
    allocation: race.perPickAmount,
    pickIndex,
  }).returning({ id: positions.id });

  const nextIndex = pickIndex + 1;
  const done = nextIndex >= order.length * race.picksPerPlayer;
  const advanced = await db.update(races)
    .set(done
      ? { currentPickIndex: nextIndex, status: "drafted" }
      : { currentPickIndex: nextIndex })
    .where(and(
      eq(races.id, 1),
      eq(races.status, "drafting"),
      eq(races.currentPickIndex, pickIndex),
    ))
    .returning({ id: races.id });
  if (advanced.length === 0) {
    if (position) await db.delete(positions).where(eq(positions.id, position.id));
    throw httpError("Pick already recorded — refresh", 409);
  }
  return { pickIndex, symbol: resolved.symbol, playerId: expected, done };
}
