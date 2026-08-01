import { NextRequest, NextResponse } from "next/server";
import { readStore, queueAdmin } from "@/lib/server/telegram-store";
import { allow } from "@/lib/server/ratelimit";
import { db } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Suggest a mini-game" from /games. Until now the form thanked people and threw their idea away —
// this delivers it to the founders' Telegram instead, and keeps a copy in the DB so nothing is lost
// if the bot is down or nobody has connected a founder chat yet.
//
// Unlike /notify-admin (server-to-server, secret-gated) this MUST be callable by an anonymous
// visitor, and unlike /wc-report the text IS user-written — that's the whole point. So the defences
// are about volume and size, not about forbidding content:
//   • rate limited per IP, plus a global hourly cap so one determined person can't flood the channel
//   • every field is length-capped and control characters stripped
//   • the card is built from escaped text (queueAdmin escapes), so no markup injection
//   • stored first, delivered second: the DB copy is the record, Telegram is the convenience

const MAX_FIELD = 600;
const GLOBAL_HOURLY_CAP = 40;

function clean(v: unknown, max = MAX_FIELD): string {
  if (typeof v !== "string") return "";
  // Strip control characters (including the zero-width tricks used to disguise spam), collapse
  // runaway whitespace, and cap the length.
  return v
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029]/g, " ")
    .replace(/\s{3,}/g, "  ")
    .trim()
    .slice(0, max);
}

export async function POST(req: NextRequest) {
  if (!allow(req, "game-idea", 5, 3)) {
    return NextResponse.json({ error: "slow down" }, { status: 429 });
  }

  const raw = (await req.json().catch(() => null)) as
    | { name?: string; description?: string; rules?: string; extra?: string }
    | null;
  if (!raw) return NextResponse.json({ error: "bad json" }, { status: 400 });

  const name = clean(raw.name, 120);
  const description = clean(raw.description);
  const rules = clean(raw.rules);
  const extra = clean(raw.extra, 200);
  if (!(name + description + rules + extra)) {
    return NextResponse.json({ error: "empty suggestion" }, { status: 400 });
  }

  const c = await db();
  await c.execute(
    `CREATE TABLE IF NOT EXISTS game_ideas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      rules TEXT NOT NULL DEFAULT '',
      extra TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    )`
  );

  // Global brake: a burst beyond this in an hour is stored but not broadcast, so the founder chat
  // stays readable during a spam wave while nothing is actually lost.
  const recent = await c.execute({
    sql: `SELECT COUNT(*) AS n FROM game_ideas WHERE created_at > ?`,
    args: [Date.now() - 60 * 60 * 1000],
  });
  const flooding = Number(recent.rows[0]?.n ?? 0) >= GLOBAL_HOURLY_CAP;

  await c.execute({
    sql: `INSERT INTO game_ideas (name, description, rules, extra, created_at) VALUES (?, ?, ?, ?, ?)`,
    args: [name, description, rules, extra, Date.now()],
  });

  if (!flooding) {
    const s = await readStore();
    // Rows render as a stats card; keep each one short so the card stays legible.
    // The card is a glance, not the document: short excerpts only. The DB row above holds the full
    // text, and the message body under the photo carries a longer (but still bounded) version —
    // a wall of characters with no spaces made both unreadable.
    // Labels must match what the form asked, word for word. They didn't: the fourth field is
    // "Anything else" — an example, why they think it'd work — and the card called it "Contact",
    // which reads as a handle to reply to. Whoever picks this up would have written to nobody.
    // Pass a generous excerpt and let the renderer do the cutting: it measures the actual tile and
    // adds the ellipsis. Chopping to a fixed count here instead produced "…on a c" — a truncation
    // that doesn't look like one, so the reader can't tell there's more.
    const rows = [
      name && `Name:${name.slice(0, 80)}`,
      description && `What is it:${description.slice(0, 80)}`,
      rules && `How it works:${rules.slice(0, 80)}`,
      extra && `Anything else:${extra.slice(0, 80)}`,
    ]
      .filter(Boolean)
      .join("|");

    const part = (v: string, max: number) => (v.length > max ? `${v.slice(0, max)}…` : v);

    await queueAdmin(s, {
      label: "Idea",
      title: name ? `Mini-game idea: ${part(name, 60)}` : "New mini-game idea",
      body: [
        part(description, 400),
        rules && `How it works: ${part(rules, 300)}`,
        extra && `Anything else: ${part(extra, 120)}`,
      ]
        .filter(Boolean)
        .join("\n"),
      value: "",
      rows,
    });
  }

  return NextResponse.json({ ok: true });
}
