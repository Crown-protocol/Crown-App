import { NextResponse } from "next/server";
import { readOffset, writeOffset, acquireBotLease } from "@/lib/server/telegram-store";

// The bot's cursor and its single-instance lease.
//   GET  ?instance=<id> → { offset, lease }  — may I run, and where did I leave off?
//   POST { offset }                          — advance the cursor after an update is fully handled
//
// Both live server-side so a bot restart resumes exactly where it stopped (an in-memory offset
// replayed a day of updates on every crash, or dropped an update when the site call failed), and so
// a second bot instance — the normal state during a deploy — is told to stand down instead of
// double-delivering everything and putting Telegram into a 409 hot loop.
const BOT_SECRET = process.env.CHEER_BOT_SECRET;

function unauthorized(req: Request): boolean {
  return !BOT_SECRET || req.headers.get("x-cheer-bot") !== BOT_SECRET;
}

export async function GET(req: Request) {
  if (unauthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const instance = new URL(req.url).searchParams.get("instance") ?? "";
  const lease = instance ? await acquireBotLease(instance) : false;
  return NextResponse.json({ offset: await readOffset(), lease });
}

export async function POST(req: Request) {
  if (unauthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { offset?: number } | null;
  if (!body || typeof body.offset !== "number") return NextResponse.json({ error: "offset required" }, { status: 400 });
  await writeOffset(body.offset);
  return NextResponse.json({ ok: true });
}
