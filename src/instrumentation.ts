export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs"
    && process.env.NODE_ENV === "production"
    && process.env.DATABASE_URL
  ) {
    const { migrateDatabase } = await import("@/lib/migrate");
    await migrateDatabase();
    const { startRaceClockTicker } = await import("@/lib/raceClock");
    startRaceClockTicker();
  }
}
