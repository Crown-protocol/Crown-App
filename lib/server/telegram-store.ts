// Server side of the Telegram bot. ALL bot behaviour lives here (and in the api/telegram routes) —
// the bot process (bot/bot.mjs) is a dumb pipe that forwards Telegram updates in and messages out.
// One writer (this Next server), one JSON file on disk, no database until the real backend lands.
//
// Every notification ships as a CARD — a PNG in the site's design rendered by /api/telegram/card —
// with an HTML caption and, where a decision is involved, inline buttons. No emoji anywhere.
// Money rule (front.md §4): the bot states facts after the fact ("$50 landed"), never promises.

import { promises as fs } from "fs";
import path from "path";
import { db, now } from "./db";
import { enqueue } from "./telegram-outbox";
import { quickStatsRows, monthlyRows, platformRows } from "./telegram-stats";
import { URGENCY_OF, URGENCY_LABEL, type NotifUrgency, type NotifKind } from "@/lib/data/notifications";

// The old JSON file — read ONCE to import legacy state into the DB, then ignored.
const LEGACY_FILE = path.join(process.cwd(), "bot", "data", "store.json");

export interface TgLink {
  chatId: number;
  tgName: string; // who connected, as Telegram reports them
  name: string; // the streamer's display name
  categories: Record<NotifUrgency, boolean>;
  monthly: boolean;
  at: number;
}

export interface TgButton {
  text: string;
  data?: string; // callback button
  url?: string; // link button
}

// One queued message. With `card` the bot renders /api/telegram/card?<card params> and sends a
// photo with the caption; without it, a plain HTML message.
export interface OutboxItem {
  chatId: number;
  caption: string; // HTML
  card?: Record<string, string>;
  buttons?: TgButton[][];
}

export interface TgStore {
  botUsername: string | null;
  pending: Record<string, { handle: string; name: string; at: number }>; // link code → who is connecting
  links: Record<string, TgLink>; // handle → linked chat
  founders: number[]; // chat ids that entered the founder secret
  outbox: OutboxItem[]; // queued messages, drained by the bot
}

// A link code is single-use and short-lived: long enough to switch apps and tap Start, short enough
// that a stale deep link in a chat history is dead.
export const LINK_CODE_TTL_MS = 15 * 60 * 1000;

const EMPTY: TgStore = { botUsername: null, pending: {}, links: {}, founders: [], outbox: [] };

// ---- persistence: the Cheer DB (was bot/data/store.json) ----
// Same read-whole/write-whole contract the routes were built on, backed by
// real tables. writeStore replaces state transactionally, so the outbox
// drain pattern (read → splice → write) stays exactly as it was.

async function importLegacyOnce(): Promise<void> {
  const c = await db();
  const done = await c.execute(`SELECT 1 FROM tg_meta WHERE key = 'legacy_imported'`);
  if (done.rows.length) return;
  try {
    const legacy = JSON.parse(await fs.readFile(LEGACY_FILE, "utf8")) as TgStore;
    await writeStore({ ...EMPTY, ...legacy });
  } catch {
    // no legacy file — nothing to carry over
  }
  await c.execute(`INSERT INTO tg_meta (key, value) VALUES ('legacy_imported', '1') ON CONFLICT(key) DO NOTHING`);
}

export async function readStore(): Promise<TgStore> {
  await importLegacyOnce();
  const c = await db();
  const [meta, pending, links, founders, outbox] = await Promise.all([
    c.execute(`SELECT value FROM tg_meta WHERE key = 'bot_username'`),
    c.execute(`SELECT * FROM tg_pending`),
    c.execute(`SELECT * FROM tg_links`),
    c.execute(`SELECT chat_id FROM tg_founders`),
    c.execute(`SELECT * FROM tg_outbox ORDER BY id`),
  ]);
  const s: TgStore = {
    botUsername: meta.rows.length ? String(meta.rows[0].value) : null,
    pending: {},
    links: {},
    founders: founders.rows.map((r) => Number(r.chat_id)),
    outbox: outbox.rows.map((r) => ({
      chatId: Number(r.chat_id),
      caption: String(r.caption),
      card: r.card ? (JSON.parse(String(r.card)) as Record<string, string>) : undefined,
      buttons: r.buttons ? (JSON.parse(String(r.buttons)) as TgButton[][]) : undefined,
    })),
  };
  for (const r of pending.rows) s.pending[String(r.code)] = { handle: String(r.handle), name: String(r.name), at: Number(r.at) };
  for (const r of links.rows)
    s.links[String(r.handle)] = {
      chatId: Number(r.chat_id),
      tgName: String(r.tg_name),
      name: String(r.name),
      categories: JSON.parse(String(r.categories)) as Record<NotifUrgency, boolean>,
      monthly: Boolean(Number(r.monthly)),
      at: Number(r.at),
    };
  return s;
}

export async function writeStore(s: TgStore): Promise<void> {
  const c = await db();
  const tx = await c.transaction("write");
  try {
    await tx.execute(`DELETE FROM tg_pending`);
    await tx.execute(`DELETE FROM tg_links`);
    await tx.execute(`DELETE FROM tg_founders`);
    if (s.botUsername) {
      await tx.execute({
        sql: `INSERT INTO tg_meta (key, value) VALUES ('bot_username', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        args: [s.botUsername],
      });
    } else {
      await tx.execute(`DELETE FROM tg_meta WHERE key = 'bot_username'`);
    }
    for (const [code, p] of Object.entries(s.pending)) {
      await tx.execute({ sql: `INSERT INTO tg_pending (code, handle, name, at) VALUES (?, ?, ?, ?)`, args: [code, p.handle, p.name, p.at] });
    }
    for (const [handle, l] of Object.entries(s.links)) {
      await tx.execute({
        sql: `INSERT INTO tg_links (handle, chat_id, tg_name, name, categories, monthly, at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [handle, l.chatId, l.tgName, l.name, JSON.stringify(l.categories), l.monthly ? 1 : 0, l.at],
      });
    }
    for (const chatId of s.founders) {
      await tx.execute({ sql: `INSERT OR IGNORE INTO tg_founders (chat_id) VALUES (?)`, args: [chatId] });
    }
    // NOTE: tg_outbox is deliberately NOT rewritten here. The queue owns its own rows and their
    // delivery state (lib/server/telegram-outbox.ts); rewriting it from a snapshot is exactly what
    // used to resurrect drained messages and drop freshly queued ones.
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

const ALL_ON: Record<NotifUrgency, boolean> = { action: true, money: true, nice: true, digest: true, system: true };

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---- queueing ----

export function findLinkByChat(s: TgStore, chatId: number): [string, TgLink] | undefined {
  return Object.entries(s.links).find(([, l]) => l.chatId === chatId);
}

// The big figure on the card = the first dollar amount in the title; the card title drops the
// " — $50" tail so the number isn't printed twice.
function splitMoney(title: string): { value: string; cardTitle: string } {
  const m = title.match(/\$[\d,]+(?:\.\d+)?/);
  if (!m) return { value: "", cardTitle: title };
  return { value: m[0], cardTitle: title.replace(/\s*[—–-]\s*\$[\d,]+(?:\.\d+)?\s*$/, "") };
}

// Inline buttons where the notification is a decision. Demo callbacks until the backend lands.
function buttonsFor(kind: NotifKind): TgButton[][] | undefined {
  if (kind === "task_offered")
    return [[{ text: "Accept", data: "demo:accept" }, { text: "Turn down", data: "demo:decline" }]];
  if (kind === "fundraiser_goal_hit") return [[{ text: "Accept the amount", data: "demo:accept" }]];
  return undefined;
}

// Queue a notification for a streamer — respects their category toggles unless forced (test button).
export async function queueNotify(
  s: TgStore,
  handle: string,
  kind: NotifKind,
  title: string,
  body: string,
  force = false
): Promise<boolean> {
  const link = s.links[handle];
  if (!link) return false;
  const urgency = URGENCY_OF[kind];
  if (!force && !link.categories[urgency]) return false;

  const { value, cardTitle } = splitMoney(title);
  await enqueue({
    chatId: link.chatId,
    caption: `<b>${esc(title)}</b>${body ? `\n${esc(body)}` : ""}`,
    card: {
      t: "notify",
      label: URGENCY_LABEL[urgency],
      value,
      title: cardTitle,
      sub: body,
      handle,
    },
    buttons: buttonsFor(kind),
  });
  return true;
}

// ---- real figures, read from the donations the indexer mirrored (lib/server/telegram-stats.ts) ----

export async function queueMonthly(s: TgStore, chatId: number, name: string, handle: string) {
  const { rows, headline } = await monthlyRows(handle);
  await enqueue({
    chatId,
    caption: `<b>${esc(name)}, your month on Cheer</b>\n${esc(headline)}`,
    card: { t: "stats", label: "Summary", title: `${name}, your month on Cheer`, rows },
  });
}

async function queueQuickStats(s: TgStore, chatId: number, name: string, handle: string) {
  await enqueue({
    chatId,
    caption: `<b>${esc(name)} — right now</b>`,
    card: { t: "stats", label: "Summary", title: `${name} — right now`, rows: await quickStatsRows(handle) },
  });
}

async function queuePlatform(s: TgStore, chatId: number) {
  await enqueue({
    chatId,
    caption: "<b>Cheer — platform</b>",
    card: { t: "stats", label: "Founders", title: "Cheer — platform", rows: await platformRows() },
  });
}

// Queue a card to every founder chat — the admin channel. `rows` switches to the stats layout.
export async function queueAdmin(
  s: TgStore,
  input: { label: string; title: string; body?: string; value?: string; rows?: string }
): Promise<number> {
  const { value, cardTitle } = input.value !== undefined ? { value: input.value, cardTitle: input.title } : splitMoney(input.title);
  for (const chatId of s.founders) {
    await enqueue({
      chatId,
      caption: `<b>${esc(input.title)}</b>${input.body ? `\n${esc(input.body)}` : ""}`,
      card: input.rows
        ? { t: "stats", label: input.label, title: input.title, rows: input.rows }
        : { t: "notify", label: input.label, value, title: cardTitle, sub: input.body ?? "" },
    });
  }
  return s.founders.length;
}

// Samples for /demo. Every one is labelled SAMPLE in its own title: scrolled back to a week later,
// a card reading "$50 landed in your wallet" is indistinguishable from real money, and this bot's
// whole promise is that it never says a number that didn't happen.
const DEMO_SAMPLES: { kind: NotifKind; title: string; body: string }[] = [
  { kind: "big_donation", title: "SAMPLE — toffi donated $50", body: "“Beat the boss with no armor on”. Not real: this is what a donation looks like." },
  { kind: "auction_lot_offered", title: "SAMPLE — new auction lot, $60", body: "Private until you accept: “Finish the map on the hardest difficulty.” Not a real lot." },
  { kind: "roulette_closing", title: "SAMPLE — roulette round closing", body: "$1,600 in the pot, 3 picks suggested. Not a real round." },
  { kind: "payout", title: "SAMPLE — $50 payout", body: "This is how a payout arrives. No money moved." },
];

// ---- the bot's brain: one Telegram update in → replies/edits out ----

export interface BotEvent {
  type: "hello" | "message" | "callback";
  username?: string; // hello
  chatId?: number;
  text?: string; // message
  tgName?: string;
  data?: string; // callback
  messageId?: number; // callback — for editing the keyboard in place
  callbackId?: string;
}

export interface BotReply {
  chatId: number;
  text: string;
  keyboard?: TgButton[][];
}

export interface BotResult {
  replies: BotReply[];
  edits: { chatId: number; messageId: number; keyboard: TgButton[][] }[];
  answerCallback?: { id: string; text?: string };
}

// No fallback: if FOUNDER_SECRET isn't set in the environment, the /founder command is simply
// unavailable — a guessable default ("cheer-founder") would let anyone claim founder mode.
const FOUNDER_SECRET = process.env.FOUNDER_SECRET;

// ● / ○ — state by shape, not emoji.
function settingsKeyboard(link: TgLink): TgButton[][] {
  const cats = (Object.keys(URGENCY_LABEL) as NotifUrgency[]).map((u) => [
    { text: `${link.categories[u] ? "●" : "○"} ${URGENCY_LABEL[u]}`, data: `cat:${u}` },
  ]);
  return [...cats, [{ text: `${link.monthly ? "●" : "○"} Monthly digest`, data: "monthly" }]];
}

const HELP = [
  "This chat gets what happens on your Cheer page: things that need you, money moves, good news, summaries, problems.",
  "",
  "/settings — choose what arrives",
  "/stats — how it's going right now",
  "/monthly — your month in one card",
  "/demo — samples, clearly marked as samples",
  "/help — this list",
  "/stop — disconnect",
].join("\n");

const NOT_CONNECTED = "Not connected yet — open your Cheer cabinet, Settings → Telegram, and tap Connect there.";

export async function handleEvent(ev: BotEvent): Promise<BotResult> {
  const s = await readStore();
  const out: BotResult = { replies: [], edits: [] };
  const reply = (chatId: number, text: string, keyboard?: TgButton[][]) => out.replies.push({ chatId, text, keyboard });

  if (ev.type === "hello" && ev.username) {
    s.botUsername = ev.username;
    await writeStore(s);
    return out;
  }

  const chatId = ev.chatId!;

  if (ev.type === "callback") {
    out.answerCallback = { id: ev.callbackId! };
    const found = findLinkByChat(s, chatId);

    // demo action buttons on notifications: acknowledge, then take the buttons away
    if (ev.data?.startsWith("demo:")) {
      out.answerCallback.text =
        ev.data === "demo:accept"
          ? "A preview — in the live version this accepts the task right from Telegram."
          : "A preview — in the live version this declines it and the viewer gets their money back.";
      if (ev.messageId) out.edits.push({ chatId, messageId: ev.messageId, keyboard: [] });
      return out;
    }

    if (found && ev.data) {
      const [, link] = found;
      if (ev.data.startsWith("cat:")) {
        const u = ev.data.slice(4) as NotifUrgency;
        link.categories[u] = !link.categories[u];
      } else if (ev.data === "monthly") {
        link.monthly = !link.monthly;
      }
      await writeStore(s);
      if (ev.messageId) out.edits.push({ chatId, messageId: ev.messageId, keyboard: settingsKeyboard(link) });
    }
    return out;
  }

  // plain message
  const text = (ev.text ?? "").trim();
  const [cmd, ...rest] = text.split(/\s+/);
  const arg = rest.join(" ");
  const found = findLinkByChat(s, chatId);

  switch (cmd) {
    case "/start": {
      const pend = arg ? s.pending[arg] : undefined;
      // A link code is a bearer token for someone's notification stream, so it can't live forever:
      // an old deep link found in a chat history must not still connect. Expired codes are cleaned
      // up here and reported honestly, instead of the generic "not connected yet" that used to send
      // people back to the cabinet they had just come from.
      const expired = !!pend && Date.now() - pend.at > LINK_CODE_TTL_MS;
      if (expired && arg) {
        delete s.pending[arg];
        await writeStore(s);
      }
      if (arg && pend && !expired) {
        const { handle, name } = pend;
        delete s.pending[arg];
        s.links[handle] = { chatId, tgName: ev.tgName ?? "", name, categories: { ...ALL_ON }, monthly: true, at: Date.now() };
        await enqueue({
          chatId,
          caption: `<b>Connected</b>\nThis chat now gets everything from ${esc(name)}'s page.`,
          card: { t: "notify", label: "Connected", title: `This chat is linked to ${name}'s page`, sub: "Everything from the bell, right here.", handle },
        });
        await writeStore(s);
        reply(chatId, HELP);
      } else if (expired) {
        reply(chatId, "That link has expired. Open your Cheer cabinet → Settings → Telegram and tap Connect again.");
      } else if (found) {
        reply(chatId, `Already connected to ${found[1].name}'s page.\n\n${HELP}`);
      } else {
        reply(chatId, NOT_CONNECTED);
      }
      break;
    }
    case "/settings": {
      if (!found) reply(chatId, NOT_CONNECTED);
      else reply(chatId, "What should arrive here? Tap to toggle — filled means on:", settingsKeyboard(found[1]));
      break;
    }
    case "/stats": {
      if (!found) reply(chatId, NOT_CONNECTED);
      else {
        await queueQuickStats(s, chatId, found[1].name, found[0]);
      }
      break;
    }
    case "/monthly": {
      if (!found) reply(chatId, NOT_CONNECTED);
      else {
        await queueMonthly(s, chatId, found[1].name, found[0]);
      }
      break;
    }
    case "/demo": {
      if (!found) reply(chatId, NOT_CONNECTED);
      else {
        for (const d of DEMO_SAMPLES) queueNotify(s, found[0], d.kind, d.title, d.body, true);
        await writeStore(s);
      }
      break;
    }
    case "/stop": {
      if (found) {
        delete s.links[found[0]];
        await writeStore(s);
        reply(chatId, "Disconnected. Reconnect any time from your cabinet — Settings → Telegram.");
      } else reply(chatId, "This chat wasn't connected to anything.");
      break;
    }
    case "/founder": {
      if (FOUNDER_SECRET && arg === FOUNDER_SECRET) {
        if (!s.founders.includes(chatId)) s.founders.push(chatId);
        await writeStore(s);
        reply(chatId, "Founder mode on. /platform shows the numbers; the monthly platform digest lands here too.");
      } else reply(chatId, "Wrong secret.");
      break;
    }
    case "/platform": {
      if (s.founders.includes(chatId)) {
        await queuePlatform(s, chatId);
      } else reply(chatId, "Founders only.");
      break;
    }
    case "/help":
      reply(chatId, HELP);
      break;
    default:
      // A command we don't know gets a short correction; ordinary chatter gets the help once,
      // instead of the whole block being dumped in reply to every stray message.
      reply(chatId, cmd.startsWith("/") ? `I don't know ${esc(cmd)}.\n\n${HELP}` : HELP);
  }

  return out;
}

// ---- bot process state (cursor + liveness) ----
// Kept out of the snapshot store on purpose: these are written by the bot on every poll, and going
// through readStore→writeStore would rewrite every tg_* table twice a second.

async function botState(key: string): Promise<string | null> {
  const c = await db();
  const r = await c.execute({ sql: `SELECT v FROM tg_bot_state WHERE k = ?`, args: [key] });
  return r.rows.length ? String(r.rows[0].v) : null;
}

async function setBotState(key: string, value: string): Promise<void> {
  const c = await db();
  await c.execute({
    sql: `INSERT INTO tg_bot_state (k, v, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at`,
    args: [key, value, now()],
  });
}

// The getUpdates cursor. Held server-side so a bot restart resumes where it left off instead of
// replaying (or skipping) a day of updates.
export async function readOffset(): Promise<number> {
  const v = await botState("offset");
  const n = v ? Number(v) : 0;
  return Number.isFinite(n) ? n : 0;
}

export async function writeOffset(offset: number): Promise<void> {
  if (!Number.isFinite(offset)) return;
  await setBotState("offset", String(offset));
}

// Heartbeat: the bot touches this every poll, so "is the bot running?" is a real question with a
// real answer instead of "botUsername was set once, months ago".
export async function touchBotSeen(): Promise<void> {
  // Stored in MILLISECONDS so botLastSeen() lines up with the consumers' `Date.now() - lastSeen`
  // staleness check (BOT_STALE_MS). `now()` is seconds — mixing them made the bot read as always down.
  await setBotState("last_seen", String(Date.now()));
}

export async function botLastSeen(): Promise<number> {
  const v = await botState("last_seen");
  const n = v ? Number(v) : 0;
  return Number.isFinite(n) ? n : 0;
}

// A single bot instance may hold the lease; a second one starting up is told to stand down. Two
// pollers would double-deliver and make Telegram return 409 in a hot loop.
export async function acquireBotLease(instanceId: string, ttlMs = 60_000): Promise<boolean> {
  const c = await db();
  const raw = await botState("lease");
  // MILLISECONDS to match ttlMs (60_000ms). `now()` is seconds — that made the 60s lease last ~16.7h,
  // so a crashed instance blocked its replacement for hours. Old seconds-valued rows read as expired.
  const nowMs = Date.now();
  if (raw) {
    try {
      const lease = JSON.parse(raw) as { id: string; at: number };
      if (lease.id !== instanceId && nowMs - lease.at < ttlMs) return false;
    } catch {}
  }
  await c.execute({
    sql: `INSERT INTO tg_bot_state (k, v, updated_at) VALUES ('lease', ?, ?)
          ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at`,
    args: [JSON.stringify({ id: instanceId, at: nowMs }), nowMs],
  });
  return true;
}
