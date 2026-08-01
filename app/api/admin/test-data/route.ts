import { NextRequest, NextResponse } from "next/server";
import { readSession } from "@/lib/server/session";
import { OWNER_ADDRESS } from "@/lib/data/session";
import { allow } from "@/lib/server/ratelimit";
import { db } from "@/lib/server/db";
import { upsertProfile, deleteProfile, getProfile } from "@/lib/server/store";
import { MOCK_STREAMERS } from "@/lib/data/mock";
import type { Profile } from "@/lib/data/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Seed / wipe demo content from the admin panel's Settings tab.
//
// The wipe is the dangerous half, so the rule is deliberately narrow: a page can be removed ONLY if
// it carries the marker this route wrote when it seeded it. Nothing that predates the marker table,
// nothing a real person registered, and nothing whose name merely *looks* like a test.
//
// That matters here specifically. The DB is full of leftovers named "DB Check" and "Sess Test" from
// automated runs, and the obvious shortcut — delete anything matching those names — is one unlucky
// handle away from deleting a creator's live page. A marker can't be guessed wrong.
function isAdmin(req: NextRequest): boolean {
  return readSession(req) === OWNER_ADDRESS;
}

const TABLE = `CREATE TABLE IF NOT EXISTS test_data (
  handle TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
)`;

// Demo pages come from the mock world the marketing surfaces already use, so seeded content looks
// like the product rather than like "Test 1, Test 2".
const SEED: Profile[] = Object.values(MOCK_STREAMERS).map((s) => ({
  handle: `demo-${s.handle}`,
  name: s.name,
  bio: `Demo page — safe to delete from admin → Settings.`,
  address: s.address,
  socials: s.socials,
  tiers: s.tiers,
}));

async function markedHandles(): Promise<string[]> {
  const c = await db();
  await c.execute(TABLE);
  const r = await c.execute(`SELECT handle FROM test_data ORDER BY handle`);
  return r.rows.map((x) => String(x.handle));
}

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const c = await db();
  const handles = await markedHandles();
  // Count only the marked pages that still exist — one deleted by hand shouldn't inflate the number.
  let present = 0;
  for (const h of handles) if (await getProfile(h)) present++;
  const total = await c.execute(`SELECT COUNT(*) AS n FROM profiles`);

  return NextResponse.json({
    test: present,
    total: Number(total.rows[0]?.n ?? 0),
    seedSize: SEED.length,
  });
}

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!allow(req, "admin-test-data", 30, 5)) return NextResponse.json({ error: "slow down" }, { status: 429 });

  const body = (await req.json().catch(() => null)) as { action?: string } | null;
  const c = await db();
  await c.execute(TABLE);

  if (body?.action === "seed") {
    const now = Date.now();
    let added = 0;
    for (const p of SEED) {
      // Never overwrite an existing handle: it could be a real page that happens to collide, and
      // clobbering it to make room for demo content would be a genuine loss.
      if (await getProfile(p.handle)) continue;
      await upsertProfile(p, ""); // no owner — a demo page belongs to nobody and can't be signed into
      await c.execute({
        sql: `INSERT OR REPLACE INTO test_data (handle, created_at) VALUES (?, ?)`,
        args: [p.handle, now],
      });
      added++;
    }
    return NextResponse.json({ ok: true, added });
  }

  if (body?.action === "wipe") {
    const handles = await markedHandles();
    let removed = 0;
    for (const h of handles) {
      if (await getProfile(h)) {
        await deleteProfile(h);
        removed++;
      }
      // Page-scoped leftovers go too, or a later seed inherits the previous run's game state.
      // game_state keys its rows "<handle>:<game>", hence the prefix match.
      await c.execute({ sql: `DELETE FROM game_state WHERE scope = ? OR scope LIKE ?`, args: [h, `${h}:%`] });
      await c.execute({ sql: `DELETE FROM notifications WHERE handle = ?`, args: [h] });
    }
    await c.execute(`DELETE FROM test_data`);
    return NextResponse.json({ ok: true, removed });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
