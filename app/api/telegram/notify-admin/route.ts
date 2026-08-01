import { NextResponse } from "next/server";
import { readStore, writeStore, queueAdmin } from "@/lib/server/telegram-store";

// Platform-level notifications → every founder chat (see /founder in the bot). This is a
// server-to-server endpoint (the real backend / a founder script calls it), never the browser.
//
// Secret-gated, fail-closed: it broadcasts to EVERY founder, so an open endpoint would let anyone
// spam the admin channel with forged platform stats. Requires x-crown-admin === CROWN_ADMIN_SECRET;
// if the env var isn't set the endpoint is simply unavailable (no guessable default).
const ADMIN_SECRET = process.env.CROWN_ADMIN_SECRET;

export async function POST(req: Request) {
  if (!ADMIN_SECRET || req.headers.get("x-crown-admin") !== ADMIN_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { label, title, body, value, rows } = (await req.json().catch(() => ({}))) as {
    label?: string;
    title?: string;
    body?: string;
    value?: string;
    rows?: string;
  };
  if (!label || !title) return NextResponse.json({ error: "label, title required" }, { status: 400 });

  const s = await readStore();
  const sent = await queueAdmin(s, { label, title, body, value, rows });
  if (sent > 0) await writeStore(s);
  return NextResponse.json({ founders: sent });
}
