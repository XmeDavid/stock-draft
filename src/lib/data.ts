import { asc, eq } from "drizzle-orm";
import { assets, players, positions, snapshots } from "@db/schema";
import { getDb } from "@/lib/db";

export type AssetRow = typeof assets.$inferSelect;
export type PositionRow = typeof positions.$inferSelect & { asset: AssetRow };
export type PlayerWithPositions = typeof players.$inferSelect & { positions: PositionRow[] };

export async function getPlayersWithPositions(): Promise<PlayerWithPositions[]> {
  const db = getDb();
  const [playerRows, positionRows] = await Promise.all([
    db.select().from(players).orderBy(asc(players.id)),
    db.select({ position: positions, asset: assets })
      .from(positions)
      .innerJoin(assets, eq(positions.assetId, assets.id))
      .orderBy(asc(positions.pickIndex)),
  ]);
  return playerRows.map((player) => ({
    ...player,
    positions: positionRows
      .filter((row) => row.position.playerId === player.id)
      .map((row) => ({ ...row.position, asset: row.asset })),
  }));
}

export async function getSnapshotsWithPlayers() {
  return getDb()
    .select({ snapshot: snapshots, player: players })
    .from(snapshots)
    .innerJoin(players, eq(snapshots.playerId, players.id))
    .orderBy(asc(snapshots.date), asc(snapshots.playerId));
}
