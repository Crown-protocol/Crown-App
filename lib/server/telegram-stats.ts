import { db } from "./db";

// Real figures for the bot's /stats, /monthly and /platform, read from the donations the indexer
// mirrored. These used to be hardcoded strings ("Today:$180 · 6 donations") shipped to real
// creators — a fabricated money figure under the product's own brand, and the exact thing the bot's
// charter forbids: it states facts after the fact, it never invents them.
//
// Schema notes (lib/server/db.ts): amounts are `gross` in USDC minor units (6 decimals), the clock
// is `block_time` in UNIX SECONDS, and the streamer handle is stored lowercased.

const MINOR = 1_000_000;
const fmtUsd = (minor: number) => `$${Math.round(minor / MINOR).toLocaleString("en-US")}`;
const secs = (ms: number) => Math.floor(ms / 1000);

function startOfDay(d = new Date()): number {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

function startOfMonth(d = new Date()): number {
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

async function sumBetween(handle: string, fromMs: number, toMs?: number): Promise<{ total: number; count: number }> {
  const c = await db();
  const r = await c.execute({
    sql: `SELECT COALESCE(SUM(gross), 0) AS total, COUNT(*) AS n FROM donations
          WHERE streamer = ? AND block_time >= ?${toMs ? " AND block_time < ?" : ""}`,
    args: toMs ? [handle.toLowerCase(), secs(fromMs), secs(toMs)] : [handle.toLowerCase(), secs(fromMs)],
  });
  return { total: Number(r.rows[0]?.total ?? 0), count: Number(r.rows[0]?.n ?? 0) };
}

// "Right now" — today and this week, plus how many distinct wallets have ever backed this page.
export async function quickStatsRows(handle: string): Promise<string> {
  const c = await db();
  const today = await sumBetween(handle, startOfDay());
  const week = await sumBetween(handle, Date.now() - 7 * 24 * 60 * 60 * 1000);
  const backers = await c.execute({
    sql: `SELECT COUNT(DISTINCT payer) AS n FROM donations WHERE streamer = ? AND payer <> ''`,
    args: [handle.toLowerCase()],
  });
  return [
    `Today:${fmtUsd(today.total)} · ${today.count} donation${today.count === 1 ? "" : "s"}`,
    `This week:${fmtUsd(week.total)} · ${week.count}`,
    `Supporters:${Number(backers.rows[0]?.n ?? 0)}`,
  ].join("|");
}

// The month, with last month for contrast and the best single day — all derived, nothing invented.
export async function monthlyRows(handle: string): Promise<{ rows: string; headline: string }> {
  const c = await db();
  const from = startOfMonth();
  const prevFrom = new Date(new Date(from).getFullYear(), new Date(from).getMonth() - 1, 1).getTime();
  const month = await sumBetween(handle, from);
  const prev = await sumBetween(handle, prevFrom, from);
  const delta = prev.total > 0 ? Math.round(((month.total - prev.total) / prev.total) * 100) : null;
  const deltaText = delta === null ? "" : ` (${delta >= 0 ? "+" : ""}${delta}%)`;

  // Best day this month: bucket block_time into local calendar days.
  const best = await c.execute({
    sql: `SELECT COALESCE(SUM(gross), 0) AS total FROM donations
          WHERE streamer = ? AND block_time >= ?
          GROUP BY date(block_time, 'unixepoch', 'localtime')
          ORDER BY total DESC LIMIT 1`,
    args: [handle.toLowerCase(), secs(from)],
  });
  const bestDay = Number(best.rows[0]?.total ?? 0);

  return {
    headline: month.count
      ? `Earned ${fmtUsd(month.total)}${deltaText} from ${month.count} donation${month.count === 1 ? "" : "s"}.`
      : "No donations this month yet.",
    rows: [`Earned:${fmtUsd(month.total)}${deltaText}`, `Donations:${month.count}`, `Best day:${fmtUsd(bestDay)}`].join("|"),
  };
}

// Whether a page saw any money in a given window — the monthly digest skips silent months rather
// than sending "you earned $0".
export async function hadActivity(handle: string, fromMs: number, toMs: number): Promise<boolean> {
  const { count } = await sumBetween(handle, fromMs, toMs);
  return count > 0;
}

// Platform-wide, for the founders' /platform.
export async function platformRows(): Promise<string> {
  const c = await db();
  const pages = await c.execute(`SELECT COUNT(*) AS n FROM profiles`);
  const month = await c.execute({
    sql: `SELECT COALESCE(SUM(gross), 0) AS total, COUNT(*) AS n FROM donations WHERE block_time >= ?`,
    args: [secs(startOfMonth())],
  });
  const supporters = await c.execute(`SELECT COUNT(DISTINCT payer) AS n FROM donations WHERE payer <> ''`);
  return [
    `Pages:${Number(pages.rows[0]?.n ?? 0)}`,
    `This month:${fmtUsd(Number(month.rows[0]?.total ?? 0))}`,
    `Donations:${Number(month.rows[0]?.n ?? 0)}`,
    `Supporters:${Number(supporters.rows[0]?.n ?? 0)}`,
  ].join("|");
}
