import { randomInt } from "node:crypto";
import { prisma } from "@/lib/db";
import { resolveTicker } from "@/lib/prices";

function httpError(message: string, status: number): Error {
  const e = new Error(message);
  (e as Error & { status?: number }).status = status;
  return e;
}

/**
 * Snake-draft turn owner: pick `pickIndex` belongs to `order[i % n]` on
 * even rounds and to `order[n - 1 - (i % n)]` on odd rounds.
 */
export function turnFor(order: number[], pickIndex: number): number {
  const n = order.length;
  if (n === 0) throw new Error("Draft order is empty");
  const slot = pickIndex % n;
  const round = Math.floor(pickIndex / n);
  return round % 2 === 0 ? order[slot] : order[n - 1 - slot];
}

/** Unbiased Fisher-Yates using crypto randomness. */
function cryptoShuffle(ids: number[]): number[] {
  const out = [...ids];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function readOrder(raw: unknown): number[] {
  if (!Array.isArray(raw)) throw httpError("Draft order is not set", 409);
  const order = raw.map(Number);
  if (order.length === 0 || order.some((id) => !Number.isFinite(id))) {
    throw httpError("Draft order is invalid", 409);
  }
  return order;
}

type StartDraftDeps = { db?: typeof prisma; shuffle?: (ids: number[]) => number[] };

export async function startDraft(
  { db = prisma, shuffle = cryptoShuffle }: StartDraftDeps = {}
): Promise<{ order: number[] }> {
  const race = await db.race.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  if (race.status !== "registration") {
    throw httpError(`Draft cannot start (status: ${race.status})`, 409);
  }
  const players = await db.player.findMany({ select: { id: true } });
  if (players.length < 2) throw httpError("At least 2 players are needed to draft", 409);

  const order = shuffle(players.map((p) => p.id));
  await db.race.update({
    where: { id: 1 },
    data: { status: "drafting", draftOrder: order, currentPickIndex: 0 },
  });
  return { order };
}

type MakePickDeps = { db?: typeof prisma; resolve?: typeof resolveTicker };

export async function makePick(
  input: { actorPlayerId: number | "admin"; symbol: string },
  { db = prisma, resolve = resolveTicker }: MakePickDeps = {}
): Promise<{ pickIndex: number; symbol: string; playerId: number; done: boolean }> {
  return db.$transaction(async (tx) => {
    const race = await tx.race.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
    if (race.status !== "drafting") {
      throw httpError(`Draft is not open (status: ${race.status})`, 409);
    }

    const order = readOrder(race.draftOrder);
    const pickIndex = race.currentPickIndex;
    const expected = turnFor(order, pickIndex);
    if (input.actorPlayerId !== "admin" && input.actorPlayerId !== expected) {
      throw httpError("Not your turn", 403);
    }

    let resolved;
    try {
      resolved = await resolve(input.symbol);
    } catch (e) {
      throw httpError(e instanceof Error ? e.message : String(e), 400);
    }
    const symbol = resolved.symbol;

    const taken = await tx.position.findFirst({ where: { asset: { symbol } } });
    if (taken) throw httpError(`${symbol} already drafted`, 409);

    const asset = await tx.asset.upsert({
      where: { symbol },
      update: {},
      create: {
        symbol,
        name: resolved.name,
        type: resolved.type,
        priceSource: "yahoo",
        sourceId: symbol,
        quoteCurrency: resolved.currency,
      },
    });

    await tx.position.create({
      data: {
        playerId: expected,
        assetId: asset.id,
        allocation: Number(race.perPickAmount),
        pickIndex,
      },
    });

    const nextIndex = pickIndex + 1;
    const done = nextIndex >= order.length * race.picksPerPlayer;
    await tx.race.update({
      where: { id: 1 },
      data: done ? { currentPickIndex: nextIndex, status: "drafted" } : { currentPickIndex: nextIndex },
    });

    return { pickIndex, symbol, playerId: expected, done };
  });
}
