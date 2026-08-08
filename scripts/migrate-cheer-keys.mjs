// Rewrites persisted keys from the crown-* era to cheer-*, so the rename doesn't orphan live data.
//
// Two stores hold them:
//   • game_state — one row per (scope, key): tasks, auction lots, roulette rounds, session
//     registries. The key column is literally "crown-tasks" and friends.
//   • profiles.data — a JSON blob that can embed the same key names inside saved game config.
//
// Idempotent: rows already migrated are left alone, so running it twice is harmless. Every write is
// wrapped in a transaction — a half-migrated game_state would show a creator an empty page while
// their data sat under a name nothing reads.
//
// Run: node scripts/migrate-cheer-keys.mjs [--dry]

import { createClient } from "@libsql/client";
import { resolve } from "node:path";

const DRY = process.argv.includes("--dry");
// Absolute path on purpose: the ESM build of @libsql/client resolves a relative file: URL against
// something other than cwd, so a relative form opened an empty database and every query came back
// "no such table".
const db = createClient({ url: `file:${resolve("data/cheer.db")}` });

const rename = (s) => s.replaceAll("crown-", "cheer-").replaceAll("crown_", "cheer_");

async function main() {
  const rows = (await db.execute("SELECT rowid, scope, k FROM game_state")).rows;
  const keyMoves = rows
    .map((r) => ({ rowid: Number(r.rowid), scope: String(r.scope), k: String(r.k) }))
    .filter((r) => r.k.includes("crown-") || r.scope.includes("crown-"));

  console.log(`game_state rows needing a rename: ${keyMoves.length} of ${rows.length}`);
  for (const m of keyMoves.slice(0, 8)) console.log(`  ${m.scope} / ${m.k} → ${rename(m.scope)} / ${rename(m.k)}`);

  const profiles = (await db.execute("SELECT handle, data FROM profiles")).rows;
  const profileMoves = profiles
    .map((p) => ({ handle: String(p.handle), data: String(p.data) }))
    .filter((p) => p.data.includes("crown-"));
  console.log(`profiles carrying crown-* inside their JSON: ${profileMoves.length} of ${profiles.length}`);

  if (DRY) {
    console.log("[dry run] nothing written");
    return;
  }

  await db.execute("BEGIN");
  try {
    for (const m of keyMoves) {
      // A row may already exist under the new name (a partial earlier run, or both keys in use):
      // keep the newer one rather than failing the primary key.
      await db.execute({
        sql: "DELETE FROM game_state WHERE scope = ? AND k = ? AND rowid <> ?",
        args: [rename(m.scope), rename(m.k), m.rowid],
      });
      await db.execute({
        sql: "UPDATE game_state SET scope = ?, k = ? WHERE rowid = ?",
        args: [rename(m.scope), rename(m.k), m.rowid],
      });
    }
    for (const p of profileMoves) {
      await db.execute({
        sql: "UPDATE profiles SET data = ? WHERE handle = ?",
        args: [rename(p.data), p.handle],
      });
    }
    await db.execute("COMMIT");
    console.log(`migrated: ${keyMoves.length} game_state rows, ${profileMoves.length} profiles`);
  } catch (e) {
    await db.execute("ROLLBACK");
    console.error("rolled back:", e.message);
    process.exitCode = 1;
  }
}

await main();

// Fold the write-ahead log back into the .db file, AFTER the transaction (a checkpoint inside one
// aborts it). Without this the migration lives only in the -wal sidecar, and moving or deleting
// that file silently undoes the whole run — which is exactly what happened the first time.
await db.execute("PRAGMA wal_checkpoint(TRUNCATE)");
