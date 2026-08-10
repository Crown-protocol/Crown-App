import { NextRequest, NextResponse } from "next/server";
import { listScopeState, applyGameOp, SYNCED_KEYS, type GameOp } from "@/lib/server/gameState";
import { allow } from "@/lib/server/ratelimit";
import { notifyGameEvent } from "@/lib/server/game-notify";
import { readSession } from "@/lib/server/session";
import { getProfileOwner } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Shared game state (see lib/server/gameState.ts). GET pulls every synced key of
// a scope in one round-trip (the client's poll); POST applies one op and returns
// the key's full new value. Trust model matches the mock game layer it replaces:
// game actions are unsigned demo-money events — the wallet-signed surface stays
// profiles/donations. Rate limits keep a vandal from spamming the accumulators.

// The exact set of validation messages applyGameOp (lib/server/gameState.ts) throws for bad input.
// Only these are safe to echo back to the client as a 400; every other error is internal and is
// answered generically. Keep in sync with the throws in gameState.ts.
const KNOWN_OP_ERRORS = new Set([
  "value too large",
  "list full",
  "bad delta",
  "append needs item.id",
  "bad suggest",
  "bad entry",
  "unknown op",
]);

function cleanScope(raw: string | null): string | null {
  const s = (raw ?? "").trim();
  if (!s || s.length > 160) return null;
  return s;
}

// The handle owning a scope. Scope is "<handle>", "<handle>:<gameId>" or "<handle>:<gameId>:<id>".
function handleOf(scope: string): string {
  return (scope.split(":")[0] || "").toLowerCase();
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

  // Viewer participation stays open (append a lot, add to a collection, suggest a pick) — that's how
  // the wallet-less game layer works. But `replace` is a wholesale state SWAP: it's how a run moves to
  // accepted / closed / settled / refunded / delivered, and it's what fires "payout — money on its
  // way" to the owner's Telegram (game-notify.ts). Those are the OWNER's decisions. Left open, anyone
  // could flip another page's collection to "settled" and spoof that payout card. So `replace` requires
  // the owner's editing session (same cookie that gates profile writes) whose pubkey owns the page
  // behind this scope. Owned page + no/other session → 403. Demo pages (owner '') stay open, matching
  // the unsigned demo-money model everywhere else.
  if (body.op.type === "replace") {
    const owner = await getProfileOwner(handleOf(scope));
    if (owner) {
      const signer = readSession(req);
      if (signer !== owner) {
        return NextResponse.json({ error: "owner session required" }, { status: 403 });
      }
    }
  }

  try {
    const v = await applyGameOp(scope, k, body.op);
    // Tell the creator's Telegram what just happened — a new paid task, a bid, a goal hit, a round
    // closing. Fire-and-forget by design: the game write is already committed and must not wait on,
    // or fail because of, a notification.
    notifyGameEvent(scope, k, body.op);
    return NextResponse.json({ v });
  } catch (e) {
    // applyGameOp throws short, intentional validation strings ("list full", "bad delta", …) that are
    // safe to echo. Anything else (a DB/driver failure) is an internal error: don't hand its raw
    // message to the client — log it and answer generically with a 500.
    const msg = e instanceof Error ? e.message : "";
    if (KNOWN_OP_ERRORS.has(msg)) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    console.error("[gamestate] op failed", e);
    return NextResponse.json({ error: "op failed" }, { status: 500 });
  }
}
