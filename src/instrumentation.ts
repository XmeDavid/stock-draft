export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const cron = (await import("node-cron")).default;
  const { runSnapshot } = await import("@/lib/snapshot");
  const { getRace } = await import("@/lib/race");
  const { startRace } = await import("@/lib/startRace");
  const hour = Number(process.env.SNAPSHOT_HOUR ?? 18);

  cron.schedule(`0 ${hour} * * *`, async () => {
    try { console.log("[cron] snapshot:", await runSnapshot()); }
    catch (e) { console.error("[cron] snapshot failed:", e); }
  }, { timezone: "UTC" });

  // Auto-start tick: flip a scheduled race to running once its time arrives.
  // startRace() re-checks status "drafted", but that read happens *outside*
  // its transaction, so concurrent ticks are not transactionally serialised —
  // a double fire is mostly harmless (positions and snapshots are upserted to
  // the same values) but is not guarded. Run a single web replica.
  cron.schedule("* * * * *", async () => {
    try {
      const race = await getRace();
      if (race.status === "drafted" && race.scheduledStartAt && new Date() >= race.scheduledStartAt) {
        await startRace();
        console.log("[cron] auto-start: race started");
      }
    } catch (e) { console.error("[cron] auto-start failed:", e); }
  }, { timezone: "UTC" });

  // Boot catch-up: record today if missing (runSnapshot upserts, so just run it)
  try { console.log("[boot] snapshot:", await runSnapshot()); }
  catch (e) { console.error("[boot] snapshot failed:", e); }
}
