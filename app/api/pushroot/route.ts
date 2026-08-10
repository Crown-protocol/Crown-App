import { NextRequest, NextResponse } from "next/server";
import { allow } from "@/lib/server/ratelimit";
import { pushRoot, type GameName } from "@/lib/server/gameRelay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Refresh a game's cached view of the book: { game: "task" | "fundraiser" }.
//
// A game is blind — it never calls the index. Instead a caller presents a
// witness and the game walks it against a root it has already authenticated.
// Authenticating one costs two BLS pairings, far past what the free boundary
// can spend, so it happens here: a paid `push_root` through the relay.
//
// Call it when a proof was refused (`BadBirthProof`), not before every action —
// each push is charged whether or not the root was new. A birth folded after
// the game's last push is exactly the case that needs it.
export async function POST(req: NextRequest) {
  // Deliberately tighter than the other two: this is the most expensive call we
  // let a browser trigger, and it is per-canister rather than per-scope, so one
  // push serves every caller who was waiting on it.
  if (!allow(req, "pushroot", 6, 3)) return NextResponse.json({ error: "slow down" }, { status: 429 });

  let body: { game?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const game = (body.game ?? "").trim();
  if (game !== "task" && game !== "fundraiser") {
    return NextResponse.json({ error: "game must be task or fundraiser" }, { status: 400 });
  }

  const out = await pushRoot(game as GameName);
  const http = out.ok ? 200 : out.tag === "Unconfigured" ? 503 : 409;
  return NextResponse.json({ ok: out.ok, tag: out.tag, detail: out.detail }, { status: http });
}
