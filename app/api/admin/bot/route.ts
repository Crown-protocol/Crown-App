import { NextRequest, NextResponse } from "next/server";
import { readStore, botLastSeen, queueNotify } from "@/lib/server/telegram-store";
import { queueSize } from "@/lib/server/telegram-outbox";
import { readSession } from "@/lib/server/session";
import { OWNER_ADDRESS } from "@/lib/data/session";
import { allow } from "@/lib/server/ratelimit";
import { db } from "@/lib/server/db";
import { BOT_SCENARIOS } from "@/lib/data/bot-scenarios";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The admin panel's Telegram tab: how the bot is doing, and a way to fire any single scenario at a
// connected chat to see exactly what it looks like.
//
// Platform-owner only, server side. The Admin pill in the UI is just a hidden door — this is the
// lock: the caller must hold an editing session for the owner wallet.
function isAdmin(req: NextRequest): boolean {
  return readSession(req) === OWNER_ADDRESS;
}

const BOT_STALE_MS = 90_000;

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const s = await readStore();
  const lastSeen = await botLastSeen();
  const c = await db();

  // Queue health: what's waiting, what's being retried, what gave up.
  const q = await c.execute(
    `SELECT
       COUNT(*) AS total,
       COALESCE(SUM(CASE WHEN attempts > 0 AND attempts < 6 THEN 1 ELSE 0 END), 0) AS retrying,
       COALESCE(SUM(CASE WHEN attempts >= 6 THEN 1 ELSE 0 END), 0) AS dead,
       COALESCE(SUM(CASE WHEN claimed_at > 0 THEN 1 ELSE 0 END), 0) AS inflight
     FROM tg_outbox`
  );
  const lastErr = await c.execute(`SELECT last_error, attempts FROM tg_outbox WHERE last_error IS NOT NULL ORDER BY id DESC LIMIT 1`);

  return NextResponse.json({
    bot: {
      username: s.botUsername,
      running: lastSeen > 0 && Date.now() - lastSeen < BOT_STALE_MS,
      lastSeen,
      // Configuration the bot can't work without — reported so a silent misconfiguration
      // ("everything looks connected, nothing arrives") is visible instead of mysterious.
      secretConfigured: !!process.env.CROWN_BOT_SECRET,
      founderSecretConfigured: !!process.env.FOUNDER_SECRET,
    },
    links: Object.entries(s.links).map(([handle, l]) => ({
      handle,
      name: l.name,
      tgName: l.tgName,
      chatId: l.chatId,
      monthly: l.monthly,
      categories: l.categories,
      at: l.at,
    })),
    founders: s.founders.length,
    pendingCodes: Object.keys(s.pending).length,
    queue: {
      total: Number(q.rows[0]?.total ?? 0),
      retrying: Number(q.rows[0]?.retrying ?? 0),
      dead: Number(q.rows[0]?.dead ?? 0),
      inflight: Number(q.rows[0]?.inflight ?? 0),
      size: await queueSize(),
      lastError: lastErr.rows.length ? String(lastErr.rows[0].last_error) : null,
    },
  });
}

// Fire one scenario at a linked chat, exactly as production would — same queue, same card, same
// category filtering unless `force` is asked for. `force` exists so an admin can preview a category
// the creator has switched off, and it is labelled as such in the UI.
export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!allow(req, "admin-bot-test", 60, 20)) return NextResponse.json({ error: "slow down" }, { status: 429 });

  const body = (await req.json().catch(() => null)) as { handle?: string; kind?: string; force?: boolean } | null;
  if (!body?.handle || !body?.kind) return NextResponse.json({ error: "handle and kind required" }, { status: 400 });

  const scenario = BOT_SCENARIOS.find((x) => x.kind === body.kind);
  if (!scenario) return NextResponse.json({ error: "unknown scenario" }, { status: 400 });

  const s = await readStore();
  if (!s.links[body.handle]) return NextResponse.json({ error: "that page has no Telegram connected" }, { status: 400 });

  const queued = await queueNotify(
    s,
    body.handle,
    scenario.kind,
    `TEST — ${scenario.sample.title}`,
    scenario.sample.body,
    !!body.force
  );
  return NextResponse.json({ queued });
}
