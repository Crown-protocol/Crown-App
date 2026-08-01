import { db } from "./db";
import { readStore, queueNotify, queueMonthly } from "./telegram-store";
import { monthlyRows } from "./telegram-stats";

// The two notifications that can't come from a user action, because they happen when nobody is
// clicking anything: a deadline running out, and the month ending.
//
// Both were promised and neither existed — the "Monthly digest" toggle in the cabinet controlled a
// digest that was never sent, and the deadline notification the whole bot is sold on could only
// ever fire if the creator happened to change the task themselves.

const HOUR = 60 * 60 * 1000;

// A task's clock is the creator's own deadlineHours from their game rules; we warn once when a
// quarter of the window (or an hour, whichever is longer) is left.
interface StoredTask {
  id: string;
  state?: string;
  amount?: number;
  text?: string;
  acceptedAt?: number;
  at?: number;
  durationHours?: number;
}

// Remember what we've already warned about, so a 10-minute tick doesn't nag every 10 minutes.
const warned = new Set<string>();

async function checkTaskDeadlines(): Promise<void> {
  const c = await db();
  const rows = await c.execute({
    sql: `SELECT scope, v FROM game_state WHERE k = 'crown-tasks'`,
  });
  const s = await readStore();

  for (const row of rows.rows) {
    const scope = String(row.scope);
    const handle = (scope.split(":")[0] || "").toLowerCase();
    if (!s.links[handle]) continue; // nobody to tell

    let tasks: StoredTask[] = [];
    try {
      const parsed = JSON.parse(String(row.v));
      if (Array.isArray(parsed)) tasks = parsed as StoredTask[];
    } catch {
      continue;
    }

    for (const t of tasks) {
      if (t.state !== "active") continue;
      const started = Number(t.acceptedAt ?? t.at ?? 0);
      const windowMs = Math.max(1, Number(t.durationHours ?? 24)) * HOUR;
      if (!started) continue;
      const left = started + windowMs - Date.now();
      const warnAt = Math.max(windowMs / 4, HOUR);
      const key = `${scope}:${t.id}`;

      if (left <= 0 && !warned.has(`${key}:over`)) {
        warned.add(`${key}:over`);
        await queueNotify(
          s,
          handle,
          "task_expiring",
          `Deadline passed — $${Math.round(Number(t.amount) || 0)}`,
          `"${String(t.text ?? "").slice(0, 90)}" is past its window. Finish it or refund the viewer.`
        );
      } else if (left > 0 && left <= warnAt && !warned.has(key)) {
        warned.add(key);
        const hours = Math.max(1, Math.round(left / HOUR));
        await queueNotify(
          s,
          handle,
          "task_deadline_soon",
          `${hours}h left on a $${Math.round(Number(t.amount) || 0)} task`,
          `"${String(t.text ?? "").slice(0, 90)}" — finish it before the window closes.`
        );
      }
    }
  }

  // Don't let the seen-set grow forever on a long-lived process.
  if (warned.size > 5000) warned.clear();
}

// One digest per linked page per calendar month, on the 1st. The marker lives in tg_bot_state so a
// restart can't send it twice.
async function sendMonthlyDigests(): Promise<void> {
  const now = new Date();
  if (now.getDate() !== 1 || now.getHours() < 9) return; // 1st of the month, not the middle of the night

  const stamp = `${now.getFullYear()}-${now.getMonth()}`;
  const c = await db();
  const seen = await c.execute({ sql: `SELECT v FROM tg_bot_state WHERE k = 'monthly_sent'`, args: [] });
  if (seen.rows.length && String(seen.rows[0].v) === stamp) return;

  const s = await readStore();
  for (const [handle, link] of Object.entries(s.links)) {
    if (!link.monthly) continue;
    // A month with no money gets no digest — "$0, down 100%" is not a summary worth pushing.
    const { rows } = await monthlyRows(handle);
    if (/^Earned:\$0\b/.test(rows)) continue;
    await queueMonthly(s, link.chatId, link.name, handle);
  }

  await c.execute({
    sql: `INSERT INTO tg_bot_state (k, v, updated_at) VALUES ('monthly_sent', ?, ?)
          ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at`,
    args: [stamp, Date.now()],
  });
}

let started = false;

export function startTelegramScheduler(): void {
  if (started) return;
  started = true;
  const tick = async () => {
    try {
      await checkTaskDeadlines();
      await sendMonthlyDigests();
    } catch (e) {
      console.error("[crown] telegram scheduler:", e instanceof Error ? e.message : e);
    }
  };
  void tick();
  setInterval(() => void tick(), 10 * 60 * 1000); // every 10 minutes
}
