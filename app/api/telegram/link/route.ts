import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { readStore, writeStore } from "@/lib/server/telegram-store";
import { authorizeHandleChannel } from "@/lib/server/auth";
import { allow } from "@/lib/server/ratelimit";

// "Connect Telegram" in the cabinet: mint a one-time code and hand back the deep link.
// The bot resolves the code when the user taps /start there.
//
// Owner-gated (the hijack vector): a pending code links WHOEVER taps /start to this handle's
// chat. If anyone could mint a code for any handle, they'd link their own Telegram to a
// streamer's page and receive all of that streamer's notifications. A real page therefore
// requires the owner's wallet signature; demo pages stay open for the wallet-less mock flow.
export async function POST(req: NextRequest) {
  if (!allow(req, "tg-link", 20, 10)) return NextResponse.json({ error: "slow down" }, { status: 429 });

  const body = (await req.json().catch(() => null)) as { handle?: string; name?: string } | null;
  const handle = body?.handle;
  const name = body?.name;
  if (!handle) return NextResponse.json({ error: "handle required" }, { status: 400 });

  const auth = await authorizeHandleChannel(req, "tg-link", handle, body);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const s = await readStore();
  const code = randomBytes(6).toString("hex");
  // one pending code per handle — a re-click invalidates the previous link
  for (const [c, p] of Object.entries(s.pending)) if (p.handle === handle) delete s.pending[c];
  s.pending[code] = { handle, name: name || handle, at: Date.now() };
  await writeStore(s);

  return NextResponse.json({
    code,
    botUsername: s.botUsername,
    deepLink: s.botUsername ? `https://t.me/${s.botUsername}?start=${code}` : null,
  });
}
