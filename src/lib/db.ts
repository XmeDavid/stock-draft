import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as schema from "@db/schema";

type Database = PostgresJsDatabase<typeof schema>;
const globalDatabase = globalThis as typeof globalThis & {
  officeStockLeagueSql?: Sql;
  officeStockLeagueDb?: Database;
};

export function getDb(): Database {
  if (globalDatabase.officeStockLeagueDb) return globalDatabase.officeStockLeagueDb;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured");
  const sql = postgres(url, { max: 10 });
  const db = drizzle(sql, { schema });
  globalDatabase.officeStockLeagueSql = sql;
  globalDatabase.officeStockLeagueDb = db;
  return db;
}

export type AppDb = ReturnType<typeof getDb>;
