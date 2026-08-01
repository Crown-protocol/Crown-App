import { NextRequest, NextResponse } from "next/server";
import { readStore, writeStore } from "@/lib/server/telegram-store";
import { authorizeHandleChannel } from "@/lib/server/auth";
import { allow } from "@/lib/server/ratelimit";

// Disconnect from the cabinet side. Says goodbye in the chat so the silence isn't a mystery.
// Owner-gated: only the streamer may sever their own page's link (otherwise it's griefing —
// anyone could disconnect anyone). Demo pages stay open for the wallet-less mock flow.
export async function POST(req: NextRequest) {
  if (!allow(req, "tg-unlink", 20, 10)) return NextResponse.json({ error: "slow down" }, { status: 429 });

  const raw = (await req.json().catch(() => null)) as { handle?: string } | null;
  const handle = raw?.handle;
  if (!handle) return NextResponse.json({ error: "handle required" }, { status: 400 });

  const auth = await authorizeHandleChannel(req, "tg-unlink", handle, raw);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const s = await readStore();
  const link = s.links[handle];
  if (link) {
    s.outbox.push({ chatId: link.chatId, caption: "Disconnected from your cabinet. Reconnect any time — Settings → Telegram." });
    delete s.links[handle];
    await writeStore(s);
  }
  return NextResponse.json({ ok: true });
}
