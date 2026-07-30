export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const cron = (await import("node-cron")).default;
  const { runSnapshot } = await import("@/lib/snapshot");
  const hour = Number(process.env.SNAPSHOT_HOUR ?? 18);

  cron.schedule(`0 ${hour} * * *`, async () => {
    try { console.log("[cron] snapshot:", await runSnapshot()); }
    catch (e) { console.error("[cron] snapshot failed:", e); }
  }, { timezone: "UTC" });

  // Boot catch-up: record today if missing (runSnapshot upserts, so just run it)
  try { console.log("[boot] snapshot:", await runSnapshot()); }
  catch (e) { console.error("[boot] snapshot failed:", e); }
}
