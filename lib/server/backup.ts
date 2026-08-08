import fs from "fs";
import path from "path";
import { backupTo, db } from "./db";

// Daily on-line snapshot of data/cheer.db → data/backups/cheer-YYYY-MM-DD.db
// (VACUUM INTO — consistent even mid-write), keeping the last 7. The DB is
// the only copy of profiles and game texts, so losing it must cost at most
// a day, not everything. No-op when the DB is remote (LIBSQL_URL).

const BACKUP_DIR = path.join(process.env.CHEER_DB_DIR || path.join(process.cwd(), "data"), "backups");
// Two ladders, because "how much can we lose" and "how far back can we go" are different questions.
// Daily snapshots answer the second (a week of history); hourly ones answer the first — a crash at
// 14:00 used to roll back to the 03:00 snapshot and take eleven hours of donations, profiles and
// game texts with it. An hour of loss is a bad afternoon; a day is a catastrophe.
const KEEP_DAILY = 7;
const KEEP_HOURLY = 24;

function rotate(pattern: RegExp, keep: number): void {
  const all = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => pattern.test(f))
    .sort()
    .reverse();
  for (const stale of all.slice(keep)) {
    try {
      fs.unlinkSync(path.join(BACKUP_DIR, stale));
    } catch {}
  }
}

export async function backupOnce(): Promise<string | null> {
  const iso = new Date().toISOString();
  const day = iso.slice(0, 10); // YYYY-MM-DD
  const hour = `${day}T${iso.slice(11, 13)}`; // YYYY-MM-DDTHH

  // The hourly snapshot is the one that runs most of the time — cheap (VACUUM INTO on a file this
  // size is milliseconds) and it's what caps the loss window.
  const hourlyDest = path.join(BACKUP_DIR, `cheer-h-${hour}.db`);
  let written: string | null = null;
  if (!fs.existsSync(hourlyDest)) {
    if (await backupTo(hourlyDest)) {
      written = hourlyDest;
      rotate(/^cheer-h-\d{4}-\d{2}-\d{2}T\d{2}\.db$/, KEEP_HOURLY);
    }
  }

  // Once a day, promote a copy into the daily ladder so the week of history doesn't get rotated away
  // by the hourly one.
  const dailyDest = path.join(BACKUP_DIR, `cheer-${day}.db`);
  if (!fs.existsSync(dailyDest)) {
    if (await backupTo(dailyDest)) {
      written = dailyDest;
      rotate(/^cheer-\d{4}-\d{2}-\d{2}\.db$/, KEEP_DAILY);
    }
  }
  return written;
}

/**
 * Sweep the rows that are only useful for a while.
 *
 * Nothing here touches money or anything a person can see — these are three short-lived scratch
 * tables that had no expiry at all, so they only ever grew:
 *
 *   donation_intents — the name/message a donor attaches to a signature BEFORE the indexer sees it.
 *                      Once the donation lands the intent has been folded into it; if no donation
 *                      ever lands, the signature was never real. Either way it's dead after a week.
 *   tg_pending       — Telegram link codes with a 15-minute TTL that nothing ever deleted. The live
 *                      table held one 12 days old.
 *   notifications    — the cabinet's bell. Old read ones are noise; unread stay.
 */
export async function sweepOnce(): Promise<Record<string, number>> {
  const c = await db();
  const nowSec = Math.floor(Date.now() / 1000);
  const weekAgo = nowSec - 7 * 86400;
  const swept: Record<string, number> = {};

  const run = async (name: string, sql: string, args: (string | number)[]) => {
    try {
      const r = await c.execute({ sql, args });
      if (r.rowsAffected) swept[name] = r.rowsAffected;
    } catch {
      // A sweep is housekeeping — never worth failing a backup tick over.
    }
  };

  // Intents older than a week: whatever they were decorating has long since settled or never existed.
  await run("intents", `DELETE FROM donation_intents WHERE created_at < ?`, [weekAgo]);
  // Link codes: `at` is in MILLISECONDS here (tg tables use ms), and the TTL is 15 minutes — an hour
  // is a generous grace period for a clock that's slightly off.
  await run("tg_pending", `DELETE FROM tg_pending WHERE at < ?`, [Date.now() - 60 * 60 * 1000]);
  // Read notifications older than 30 days. Unread ones are never swept: they're still someone's news.
  await run("notifications", `DELETE FROM notifications WHERE read = 1 AND created_at < ?`, [nowSec - 30 * 86400]);

  return swept;
}

const LOOP_KEY = Symbol.for("cheer.backup.loop");

export function startBackupLoop(): void {
  const g = globalThis as { [LOOP_KEY]?: boolean };
  if (g[LOOP_KEY]) return;
  g[LOOP_KEY] = true;
  const run = () => {
    // Sweep first, snapshot second — so expired scratch rows don't get preserved in the backup.
    void sweepOnce()
      .then((swept) => {
        const n = Object.entries(swept);
        if (n.length) console.log(`[sweep] ${n.map(([k, v]) => `${k}: ${v}`).join(", ")}`);
      })
      .catch((e) => console.warn("[sweep] failed:", e?.message ?? e))
      .finally(() => {
        backupOnce()
          .then((dest) => {
            if (dest) console.log(`[backup] snapshot written: ${dest}`);
          })
          .catch((e) => console.warn("[backup] failed:", e?.message ?? e));
      });
  };
  run();
  setInterval(run, 60 * 60 * 1000); // hourly: writes an hourly snapshot, plus a daily one once a day
}
