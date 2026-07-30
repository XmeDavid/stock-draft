import path from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { getDb } from "@/lib/db";

export async function migrateDatabase() {
  await migrate(getDb(), {
    migrationsFolder: path.join(process.cwd(), "drizzle"),
  });
}
