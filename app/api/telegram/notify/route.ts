import { NextRequest, NextResponse } from "next/server";
import { readStore, writeStore, queueNotify } from "@/lib/server/telegram-store";
import { authorizeHandleChannel } from "@/lib/server/auth";
import { allow } from "@/lib/server/ratelimit";
import type { NotifKind } from "@/lib/data/notifications";

// A notification lands in a streamer's linked chat. Owner-gated: without this, anyone could POST
// a forged "$5000 landed" card into any streamer's Telegram. A real page requires the owner's
// wallet signature (the "Send a test" button in the cabinet signs); a demo page stays open so the
// wallet-less mock donate flow keeps working. Real on-chain donations don't come through here —
// the indexer calls queueNotify in-process (lib/server/indexer.ts), never over HTTP.
export async function POST(req: NextRequest) {
  if (!allow(req, "tg-notify", 30, 15)) return NextResponse.json({ error: "slow down" }, { status: 429 });

  const raw = (await req.json().catch(() => null)) as {
    handle?: string;
    kind?: NotifKind;
    title?: string;
    body?: string;
    force?: boolean;
  } | null;
  if (!raw?.handle || !raw?.kind || !raw?.title) {
    return NextResponse.json({ error: "handle, kind, title required" }, { status: 400 });
  }

  const auth = await authorizeHandleChannel(req, "tg-notify", raw.handle, raw);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const s = await readStore();
  const queued = await queueNotify(s, raw.handle, raw.kind, raw.title, raw.body ?? "", !!raw.force);
  if (queued) await writeStore(s);
  return NextResponse.json({ queued });
}
