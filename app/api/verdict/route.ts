import { NextRequest, NextResponse } from "next/server";
import { allow } from "@/lib/server/ratelimit";
import { verdictOf, type GameName } from "@/lib/server/gameRelay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The scope's verdict signature: { game: "task" | "fundraiser", scope }.
//
// `scope` is the id in the encoding its own canister uses — base58 for a task,
// hex for a collection. The answer carries the outcome (settle = 0, cancel /
// refund = 1) and the resolver's signature as hex, which is everything a client
// needs to build the ed25519 instruction that precedes `claim`.
//
// Whoever holds the bytes can settle the escrow — `claim` is permissionless by
// design, so this is not a secret and needs no auth. What it is, is *paid*: the
// free store is tried first and the relay is only asked when the scope has no
// signature yet.
export async function POST(req: NextRequest) {
  if (!allow(req, "verdict", 20, 10)) return NextResponse.json({ error: "slow down" }, { status: 429 });

  let body: { game?: string; scope?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const game = (body.game ?? "").trim();
  const scope = (body.scope ?? "").trim();
  if (game !== "task" && game !== "fundraiser") {
    return NextResponse.json({ error: "game must be task or fundraiser" }, { status: 400 });
  }
  if (!scope || scope.length > 120) return NextResponse.json({ error: "scope required" }, { status: 400 });

  const out = await verdictOf(game as GameName, scope);
  if (!out.ok || !out.verdict) {
    const http = out.tag === "Unconfigured" ? 503 : 409;
    return NextResponse.json({ ok: false, tag: out.tag, detail: out.detail }, { status: http });
  }
  return NextResponse.json({
    ok: true,
    outcome: out.verdict.outcome,
    signature: Buffer.from(out.verdict.signature).toString("hex"),
  });
}
