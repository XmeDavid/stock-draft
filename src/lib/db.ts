import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@db/schema";

export function getDb() {
  if (!env.DB) throw new Error("Persistent database is unavailable");
  return drizzle(env.DB, { schema });
}

export function getD1(): D1Database {
  if (!env.DB) throw new Error("Persistent database is unavailable");
  return env.DB;
}

export type AppDb = ReturnType<typeof getDb>;
