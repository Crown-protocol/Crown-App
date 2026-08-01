import { NextRequest, NextResponse } from "next/server";
import { listScopeState, applyGameOp, SYNCED_KEYS, type GameOp } from "@/lib/server/gameState";
import { allow } from "@/lib/server/ratelimit";
import { notifyGameEvent } from "@/lib/server/game-notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Shared game state (see lib/server/gameState.ts). GET pulls every synced key of
// a scope in one round-trip (the client's poll); POST applies one op and returns
// the key's full new value. Trust model matches the mock game layer it replaces:
// game actions are unsigned demo-money events — the wallet-signed surface stays
// profiles/donations. Rate limits keep a vandal from spamming the accumulators.

function cleanScope(raw: string | null): string | null {
  const s = (raw ?? "").trim();
  if (!s || s.length > 160) return null;
  return s;
}

export async function GET(req: NextRequest) {
  const scope = cleanScope(req.nextUrl.searchParams.get("scope"));
  if (!scope) return NextResponse.json({ error: "scope required" }, { status: 400 });
  const entries = await listScopeState(scope);
  return NextResponse.json({ entries });
}

export async function POST(req: NextRequest) {
  if (!allow(req, "gamestate-write", 30, 10)) return NextResponse.json({ error: "slow down" }, { status: 429 });

  let body: { scope?: string; k?: string; op?: GameOp };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const scope = cleanScope(body.scope ?? null);
  const k = body.k ?? "";
  if (!scope) return NextResponse.json({ error: "scope required" }, { status: 400 });
  if (!(SYNCED_KEYS as readonly string[]).includes(k)) return NextResponse.json({ error: "unknown key" }, { status: 400 });
  if (!body.op || typeof body.op !== "object") return NextResponse.json({ error: "op required" }, { status: 400 });

  try {
    const v = await applyGameOp(scope, k, body.op);
    // Tell the creator's Telegram what just happened — a new paid task, a bid, a goal hit, a round
    // closing. Fire-and-forget by design: the game write is already committed and must not wait on,
    // or fail because of, a notification.
    notifyGameEvent(scope, k, body.op);
    return NextResponse.json({ v });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "op failed" }, { status: 400 });
  }
}
