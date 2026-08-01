import { NextResponse } from "next/server";
import { claim, ack, fail, dropChat, prune } from "@/lib/server/telegram-outbox";
import { readStore, writeStore, touchBotSeen } from "@/lib/server/telegram-store";

// The bot's delivery pipe.
//   GET  — claim a batch (rows are marked in flight, not deleted)
//   POST — report what happened: { ok: [ids], failed: [{id, error}], blocked: [chatIds] }
// Only an acked row leaves the queue, so a bot crash or a Telegram 429 costs a retry, not the
// message. See lib/server/telegram-outbox.ts for the state machine.
//
// FAIL-CLOSED: without CROWN_BOT_SECRET configured the pipe is disabled entirely. It used to be
// "check the secret only if one is set", which silently made this endpoint public whenever the env
// var didn't reach the process — letting anyone read every queued card and destroy the queue.
const BOT_SECRET = process.env.CROWN_BOT_SECRET;

function unauthorized(req: Request): boolean {
  return !BOT_SECRET || req.headers.get("x-crown-bot") !== BOT_SECRET;
}

export async function GET(req: Request) {
  if (unauthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await touchBotSeen(); // the bot polling IS the heartbeat — the cabinet uses it for liveness
  const items = await claim();
  void prune();
  return NextResponse.json({ items });
}

export async function POST(req: Request) {
  if (unauthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    ok?: number[];
    failed?: { id: number; error?: string }[];
    blocked?: number[];
  } | null;
  if (!body) return NextResponse.json({ error: "bad json" }, { status: 400 });

  await ack((body.ok ?? []).filter((n) => Number.isFinite(n)));
  for (const f of body.failed ?? []) {
    if (Number.isFinite(f?.id)) await fail(f.id, f.error ?? "send failed");
  }

  // A chat that blocked the bot (Telegram 403) will never accept anything again: drop its queue and
  // its link, so the cabinet stops claiming "Connected" and we stop burning attempts forever.
  const blocked = (body.blocked ?? []).filter((n) => Number.isFinite(n));
  if (blocked.length) {
    const s = await readStore();
    let changed = false;
    for (const chatId of blocked) {
      await dropChat(chatId);
      for (const [handle, link] of Object.entries(s.links)) {
        if (link.chatId === chatId) {
          delete s.links[handle];
          changed = true;
        }
      }
      const i = s.founders.indexOf(chatId);
      if (i >= 0) {
        s.founders.splice(i, 1);
        changed = true;
      }
    }
    if (changed) await writeStore(s);
  }

  return NextResponse.json({ ok: true });
}
