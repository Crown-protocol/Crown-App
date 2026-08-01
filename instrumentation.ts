// Runs once per server boot (next.config experimental.instrumentationHook):
// starts the devnet mirror indexer, the daily DB backup, and process-level
// error logging inside the Next server process. Edge and client bundles
// import this too, so gate hard on the node runtime.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Unhandled failures must land in the server log, not vanish.
  process.on("unhandledRejection", (reason) => {
    console.error("[crown] unhandled rejection:", reason instanceof Error ? reason.stack : reason);
  });
  process.on("uncaughtException", (err) => {
    console.error("[crown] uncaught exception:", err.stack ?? err);
  });

  const { startIndexerLoop } = await import("./lib/server/indexer");
  startIndexerLoop();

  const { startBackupLoop } = await import("./lib/server/backup");
  startBackupLoop();

  // Deadlines and the monthly digest — the two notifications nobody can trigger by clicking.
  const { startTelegramScheduler } = await import("./lib/server/telegram-scheduler");
  startTelegramScheduler();
}
