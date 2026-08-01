import { NextRequest, NextResponse } from "next/server";
import { readStore, botLastSeen } from "@/lib/server/telegram-store";
import { authorizeHandleMutation } from "@/lib/server/auth";
import { readSession } from "@/lib/server/session";
import { getProfileOwner } from "@/lib/server/store";
import { allow } from "@/lib/server/ratelimit";

// The cabinet panel polls this: is the bot alive, is this handle linked, what's toggled on.
//
// PRIVATE. It used to answer for any handle with no auth at all, leaking whether a creator has
// Telegram connected, under which Telegram display name, and their notification settings — a
// deanonymisation primitive anyone could sweep across every handle.
//
// The bot's liveness (botUsername + running) is harmless, so it always comes back; everything tied
// to a person requires proving you own that page.
const BOT_STALE_MS = 90_000; // the bot heartbeats on every outbox poll (~2s); 90s late = not running

export async function GET(req: NextRequest) {
  if (!allow(req, "tg-status", 120, 40)) return NextResponse.json({ error: "slow down" }, { status: 429 });

  const handle = req.nextUrl.searchParams.get("handle");
  const s = await readStore();
  const lastSeen = await botLastSeen();
  const base = {
    botUsername: s.botUsername,
    botRunning: lastSeen > 0 && Date.now() - lastSeen < BOT_STALE_MS,
  };
  const blank = { ...base, linked: false, tgName: null, categories: null, monthly: null };
  if (!handle) return NextResponse.json(blank);

  // Owned page → only the owner (editing session or wallet signature) sees its Telegram state.
  const owner = await getProfileOwner(handle);
  if (owner) {
    const session = readSession(req);
    if (session !== owner) {
      const auth = await authorizeHandleMutation(req, "tg-status", handle, null);
      if (!auth.ok) return NextResponse.json(blank);
    }
  }

  const link = s.links[handle];
  return NextResponse.json({
    ...base,
    linked: !!link,
    tgName: link?.tgName ?? null,
    categories: link?.categories ?? null,
    monthly: link?.monthly ?? null,
  });
}
