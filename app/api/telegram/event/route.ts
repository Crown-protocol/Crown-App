import { NextResponse } from "next/server";
import { handleEvent, type BotEvent } from "@/lib/server/telegram-store";

// The bot process forwards every Telegram update here and sends back whatever we return.
// All bot behaviour is decided on this side — see lib/server/telegram-store.ts.
//
// FAIL-CLOSED. This is the most dangerous endpoint in the subsystem: a forged event can rewrite the
// bot username (repointing every "Connect Telegram" link at someone else's bot), disconnect a chat,
// brute-force the founder secret without Telegram's flood limits, or redeem a link code. It used to
// be gated only "if a secret is configured" — so a deploy where CROWN_BOT_SECRET didn't reach the
// process turned it public. Now: no secret, no pipe.
const BOT_SECRET = process.env.CROWN_BOT_SECRET;

export async function POST(req: Request) {
  if (!BOT_SECRET || req.headers.get("x-crown-bot") !== BOT_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const raw = (await req.json().catch(() => null)) as Partial<BotEvent> | null;
  if (!raw || typeof raw.type !== "string") {
    return NextResponse.json({ error: "bad event" }, { status: 400 });
  }
  // Shape check at the trust boundary: handleEvent force-unwraps chatId/callbackId, and a malformed
  // body used to be able to write a link row with chatId undefined.
  if (raw.type === "message" && (typeof raw.chatId !== "number" || typeof raw.text !== "string")) {
    return NextResponse.json({ error: "bad message event" }, { status: 400 });
  }
  if (raw.type === "callback" && (typeof raw.chatId !== "number" || typeof raw.callbackId !== "string")) {
    return NextResponse.json({ error: "bad callback event" }, { status: 400 });
  }

  return NextResponse.json(await handleEvent(raw as BotEvent));
}
