import { db } from "./db";

// ──────────────────────────────────────────────────────────────────
// The Telegram delivery queue, at-least-once.
//
// It used to live inside the whole-store snapshot (readStore → mutate → writeStore rewrites every
// tg_* table). That had two fatal properties: the bot's GET /outbox DELETED rows before anything was
// actually sent — a crash or a Telegram 429 lost those notifications for good — and two writers
// (the indexer queueing a donation, the bot draining) would clobber each other's snapshot.
//
// So the queue is its own table with its own row-level SQL:
//   enqueue   → one INSERT, no snapshot involved
//   claim     → hand the bot rows that are DUE and not already in flight, stamping claimed_at
//   ack       → the bot confirms Telegram accepted it; only then does the row go
//   fail      → record the error and schedule a retry with growing backoff
//   reap      → rows claimed but never acked (bot died mid-send) come back after a timeout
//   prune     → dead letters and ancient rows don't accumulate forever
// ──────────────────────────────────────────────────────────────────

export interface OutboxRow {
  id: number;
  chatId: number;
  caption: string;
  card?: Record<string, string>;
  buttons?: unknown;
  attempts: number;
}

// A claim is considered abandoned after this long — the bot died between claim and ack, so the row
// becomes eligible again. Comfortably longer than a slow card render + photo upload.
const CLAIM_TIMEOUT_MS = 2 * 60 * 1000;
// Give up after this many tries; the row stays as a dead letter for inspection, not delivery.
const MAX_ATTEMPTS = 6;
// Backoff between attempts: 5s, 20s, 45s, 80s, 125s (attempt² × 5s), capped.
const backoffMs = (attempts: number) => Math.min(attempts * attempts * 5000, 5 * 60 * 1000);
// Dead letters and delivered-long-ago rows are swept after this.
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;

export async function enqueue(item: { chatId: number; caption: string; card?: Record<string, string>; buttons?: unknown }): Promise<void> {
  const c = await db();
  await c.execute({
    sql: `INSERT INTO tg_outbox (chat_id, caption, card, buttons, created_at, claimed_at, attempts, next_try_at)
          VALUES (?, ?, ?, ?, ?, 0, 0, 0)`,
    args: [item.chatId, item.caption, item.card ? JSON.stringify(item.card) : null, item.buttons ? JSON.stringify(item.buttons) : null, Date.now()],
  });
}

// Hand the bot a batch to send. Rows are marked claimed so a second bot instance (or an overlapping
// drain from the same one) can't pick up the same message.
export async function claim(limit = 20): Promise<OutboxRow[]> {
  const c = await db();
  const now = Date.now();
  // Free anything a dead bot left in flight before choosing this batch.
  await c.execute({
    sql: `UPDATE tg_outbox SET claimed_at = 0 WHERE claimed_at > 0 AND claimed_at < ?`,
    args: [now - CLAIM_TIMEOUT_MS],
  });
  const rows = await c.execute({
    sql: `SELECT id, chat_id, caption, card, buttons, attempts FROM tg_outbox
          WHERE claimed_at = 0 AND next_try_at <= ? AND attempts < ?
          ORDER BY id LIMIT ?`,
    args: [now, MAX_ATTEMPTS, limit],
  });
  if (!rows.rows.length) return [];
  const ids = rows.rows.map((r) => Number(r.id));
  await c.execute({
    sql: `UPDATE tg_outbox SET claimed_at = ? WHERE id IN (${ids.map(() => "?").join(",")})`,
    args: [now, ...ids],
  });
  return rows.rows.map((r) => ({
    id: Number(r.id),
    chatId: Number(r.chat_id),
    caption: String(r.caption),
    card: r.card ? (JSON.parse(String(r.card)) as Record<string, string>) : undefined,
    buttons: r.buttons ? JSON.parse(String(r.buttons)) : undefined,
    attempts: Number(r.attempts),
  }));
}

// Telegram accepted it — the row's job is done.
export async function ack(ids: number[]): Promise<void> {
  if (!ids.length) return;
  const c = await db();
  await c.execute({ sql: `DELETE FROM tg_outbox WHERE id IN (${ids.map(() => "?").join(",")})`, args: ids });
}

// Delivery failed — count the attempt and come back later. Unclaiming is what makes the next claim()
// pick it up again once next_try_at passes.
export async function fail(id: number, error: string): Promise<void> {
  const c = await db();
  const row = await c.execute({ sql: `SELECT attempts FROM tg_outbox WHERE id = ?`, args: [id] });
  const attempts = (row.rows.length ? Number(row.rows[0].attempts) : 0) + 1;
  await c.execute({
    sql: `UPDATE tg_outbox SET claimed_at = 0, attempts = ?, next_try_at = ?, last_error = ? WHERE id = ?`,
    args: [attempts, Date.now() + backoffMs(attempts), error.slice(0, 300), id],
  });
}

// A chat that blocked the bot will never accept anything again: drop its whole queue so we stop
// burning attempts (and the link itself is removed by the caller).
export async function dropChat(chatId: number): Promise<void> {
  const c = await db();
  await c.execute({ sql: `DELETE FROM tg_outbox WHERE chat_id = ?`, args: [chatId] });
}

// Housekeeping: dead letters and anything ancient. Called opportunistically on drain.
export async function prune(): Promise<void> {
  const c = await db();
  await c.execute({ sql: `DELETE FROM tg_outbox WHERE attempts >= ? AND created_at < ?`, args: [MAX_ATTEMPTS, Date.now() - KEEP_MS] });
}

export async function queueSize(): Promise<number> {
  const c = await db();
  const r = await c.execute(`SELECT count(*) AS n FROM tg_outbox`);
  return Number(r.rows[0]?.n ?? 0);
}
