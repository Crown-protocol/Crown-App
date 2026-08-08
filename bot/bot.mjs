#!/usr/bin/env node
// Cheer Telegram bot — a dumb pipe. Telegram updates go to the site, whatever the site answers goes
// back to Telegram, and the site's outbox is drained into chats. Zero npm dependencies; all the
// actual behaviour lives in the Next server (lib/server/telegram-store.ts), so when the real
// backend arrives this file doesn't change.
//
// Notifications are photos: the site renders a PNG card (/api/telegram/card) in the product's
// design, this process downloads it and uploads to Telegram (Telegram can't reach localhost).
//
// Delivery is at-least-once: the site hands out CLAIMED rows, this process reports back what
// Telegram actually accepted, and only then do they leave the queue. A crash mid-send costs a
// retry, not the notification.
//
// Run:  npm run bot     (token + secret in bot/.env, from @BotFather)

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SITE = process.env.CHEER_SITE || "http://localhost:3000";
// Shared secret for the bot↔server pipe. The server is fail-closed: without a matching secret every
// call is refused, so a missing value here means "nothing will ever work", not "runs unprotected".
const BOT_SECRET = process.env.CHEER_BOT_SECRET;
// Identifies this process to the server's single-instance lease.
const INSTANCE = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

const die = (msg) => {
  console.error(msg);
  process.exit(1);
};

if (!TOKEN) {
  die("TELEGRAM_BOT_TOKEN is not set.\n1) Message @BotFather → /newbot → copy the token\n2) put it in bot/.env: TELEGRAM_BOT_TOKEN=<token>");
}
if (!BOT_SECRET) {
  die("CHEER_BOT_SECRET is not set.\nThe server refuses the bot pipe without it (fail-closed).\nPut the SAME value in bot/.env and the site's .env.local: CHEER_BOT_SECRET=<secret>");
}

// A crash must be loud and fatal, so the process manager restarts us instead of leaving a zombie
// that polls nothing.
process.on("unhandledRejection", (e) => die(`[fatal] unhandled rejection: ${e?.message ?? e}`));
process.on("uncaughtException", (e) => die(`[fatal] uncaught exception: ${e?.message ?? e}`));

const log = (msg) => console.log(`${new Date().toISOString()} ${msg}`);
const logErr = (msg) => console.error(`${new Date().toISOString()} ${msg}`);

// Telegram call. Returns { ok, description, retryAfter, status } — callers decide what a failure
// means; nothing is swallowed silently any more.
const tg = async (method, body, timeoutMs = 30000) => {
  const ctl = AbortSignal.timeout(timeoutMs);
  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal: ctl,
    });
    const json = await res.json();
    if (!json.ok) logErr(`[tg] ${method}: ${json.description}`);
    return { ...json, status: res.status, retryAfter: json.parameters?.retry_after ?? 0 };
  } catch (e) {
    logErr(`[tg] ${method}: ${e.message}`);
    return { ok: false, description: e.message, status: 0, retryAfter: 0 };
  }
};

// sendPhoto goes multipart — the card bytes are uploaded, not linked.
const tgPhoto = async (chatId, png, caption, replyMarkup) => {
  const fd = new FormData();
  fd.append("chat_id", String(chatId));
  fd.append("photo", new Blob([png], { type: "image/png" }), "card.png");
  fd.append("caption", caption);
  fd.append("parse_mode", "HTML");
  if (replyMarkup) fd.append("reply_markup", JSON.stringify(replyMarkup));
  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendPhoto`, {
      method: "POST",
      body: fd,
      signal: AbortSignal.timeout(60000),
    });
    const json = await res.json();
    if (!json.ok) logErr(`[tg] sendPhoto: ${json.description}`);
    return { ...json, status: res.status, retryAfter: json.parameters?.retry_after ?? 0 };
  } catch (e) {
    logErr(`[tg] sendPhoto: ${e.message}`);
    return { ok: false, description: e.message, status: 0, retryAfter: 0 };
  }
};

const site = async (path, init = {}, timeoutMs = 20000) => {
  const headers = { ...(init.headers || {}), "x-cheer-bot": BOT_SECRET };
  const res = await fetch(`${SITE}/api/telegram/${path}`, { ...init, headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
};

const toInlineKeyboard = (rows) => ({
  inline_keyboard: rows.map((row) => row.map((b) => (b.url ? { text: b.text, url: b.url } : { text: b.text, callback_data: b.data }))),
});

// "The user blocked us / the chat is gone" — permanent for that chat, so the server should drop the
// link rather than retry forever.
const isBlocked = (r) =>
  r.status === 403 || /bot was blocked|user is deactivated|chat not found|bot was kicked/i.test(r.description ?? "");

// Send everything the brain decided: replies, keyboard edits, callback acks.
async function dispatch(result) {
  for (const r of result.replies ?? []) {
    await tg("sendMessage", {
      chat_id: r.chatId,
      text: r.text,
      link_preview_options: { is_disabled: true },
      ...(r.keyboard ? { reply_markup: toInlineKeyboard(r.keyboard) } : {}),
    });
  }
  for (const e of result.edits ?? []) {
    await tg("editMessageReplyMarkup", { chat_id: e.chatId, message_id: e.messageId, reply_markup: toInlineKeyboard(e.keyboard) });
  }
  if (result.answerCallback) {
    await tg("answerCallbackQuery", { callback_query_id: result.answerCallback.id, text: result.answerCallback.text });
  }
}

// One outbox row → a photo card (preferred) or a plain message.
// Returns "ok" | "blocked" | an error string, so the caller can ack, unlink, or schedule a retry.
async function deliver(m) {
  if (m.card) {
    try {
      void tg("sendChatAction", { chat_id: m.chatId, action: "upload_photo" });
      const res = await fetch(`${SITE}/api/telegram/card?${new URLSearchParams(m.card)}`, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`card → ${res.status}`);
      const png = Buffer.from(await res.arrayBuffer());
      const sent = await tgPhoto(m.chatId, png, m.caption, m.buttons ? toInlineKeyboard(m.buttons) : undefined);
      if (sent.ok) return "ok";
      if (isBlocked(sent)) return "blocked";
      if (sent.retryAfter) await new Promise((r) => setTimeout(r, Math.min(sent.retryAfter, 30) * 1000));
      // Card send failed for a non-permanent reason — fall through to plain text rather than losing it.
    } catch (e) {
      logErr(`[card] ${e.message} — falling back to text`);
    }
  }
  const sent = await tg("sendMessage", {
    chat_id: m.chatId,
    text: m.caption,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(m.buttons ? { reply_markup: toInlineKeyboard(m.buttons) } : {}),
  });
  if (sent.ok) return "ok";
  if (isBlocked(sent)) return "blocked";
  if (sent.retryAfter) await new Promise((r) => setTimeout(r, Math.min(sent.retryAfter, 30) * 1000));
  return sent.description || "send failed";
}

// One drain pass. Guarded against overlap by the caller — two concurrent drains would claim two
// batches and interleave sends.
let draining = false;
async function drainOnce() {
  if (draining) return;
  draining = true;
  try {
    const { items } = await site("outbox");
    if (!items.length) return;
    const ok = [];
    const failed = [];
    const blocked = new Set();
    for (const m of items) {
      const verdict = await deliver(m);
      if (verdict === "ok") {
        ok.push(m.id);
        log(`[sent] #${m.id} → ${m.chatId}`);
      } else if (verdict === "blocked") {
        blocked.add(m.chatId);
        ok.push(m.id); // nothing to retry: that chat is gone
        log(`[blocked] chat ${m.chatId} — unlinking`);
      } else {
        failed.push({ id: m.id, error: verdict });
        logErr(`[retry] #${m.id} → ${m.chatId}: ${verdict}`);
      }
    }
    await site("outbox", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok, failed, blocked: [...blocked] }),
    });
  } catch (e) {
    // Nothing was acked, so everything we claimed comes back automatically once the claim times out.
    logErr(`[outbox] ${e.message}`);
  } finally {
    draining = false;
  }
}

async function main() {
  const me = await tg("getMe");
  if (!me.ok) die(`[bot] getMe failed: ${me.description}`);

  // One poller at a time. A second instance (the normal state mid-deploy) would double-deliver and
  // make Telegram answer 409 to both.
  let cursor;
  try {
    cursor = await site(`cursor?instance=${encodeURIComponent(INSTANCE)}`);
  } catch (e) {
    die(`[bot] can't reach the site at ${SITE} (${e.message}).\nIs it running, and does CHEER_BOT_SECRET match .env.local?`);
  }
  if (!cursor.lease) die("[bot] another bot instance is already running — stopping.\nStop it first, or wait ~60s for its lease to lapse.");

  log(`[bot] @${me.result.username} → ${SITE} (instance ${INSTANCE})`);
  await site("event", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "hello", username: me.result.username }),
  });

  await tg("setMyCommands", {
    commands: [
      { command: "settings", description: "Choose what arrives here" },
      { command: "stats", description: "How it's going right now" },
      { command: "monthly", description: "Your month in one card" },
      { command: "help", description: "What this bot can do" },
      { command: "stop", description: "Disconnect" },
    ],
  });
  await tg("setMyShortDescription", { short_description: "Your Cheer page, in your pocket: donations, deadlines, payouts." });
  await tg("setMyDescription", {
    description:
      "Notifications from your Cheer donation page: things that need you, money moves, good news, monthly digests. Connect from your cabinet — Settings → Telegram.",
  });

  // outbox drain — messages queued by the site
  setInterval(() => void drainOnce(), 2000);
  // keep the lease warm so a restart of THIS process can reclaim it, and a second one can't
  setInterval(() => void site(`cursor?instance=${encodeURIComponent(INSTANCE)}`).catch(() => {}), 30000);

  // long-poll Telegram; transient network failures just retry
  let offset = cursor.offset ?? 0;
  for (;;) {
    try {
      const upd = await tg("getUpdates", { offset, timeout: 25, allowed_updates: ["message", "callback_query"] }, 40000);
      if (!upd.ok) {
        // 409 = another getUpdates is running. Backing off matters: without it this spins hot.
        await new Promise((r) => setTimeout(r, upd.status === 409 ? 5000 : 3000));
        continue;
      }
      for (const u of upd.result ?? []) {
        let ev = null;
        if (u.message?.text) {
          ev = { type: "message", chatId: u.message.chat.id, text: u.message.text, tgName: u.message.from?.first_name ?? "" };
        } else if (u.callback_query) {
          ev = {
            type: "callback",
            chatId: u.callback_query.message?.chat?.id,
            messageId: u.callback_query.message?.message_id,
            data: u.callback_query.data,
            callbackId: u.callback_query.id,
          };
        }
        if (ev) {
          // The site call comes FIRST: only once the update is fully handled do we move the cursor.
          // Advancing first (as this used to) dropped the update whenever the site was unreachable.
          const result = await site("event", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(ev),
          });
          await dispatch(result);
        }
        offset = u.update_id + 1;
        await site("cursor", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ offset }) }).catch(() => {});
      }
    } catch (e) {
      logErr(`[poll] ${e.message} — retrying in 3s`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

main();
