import { NextRequest, NextResponse } from "next/server";
import { allow } from "@/lib/server/ratelimit";
import { getRound } from "@/lib/server/roulette";
import { readWheel } from "@/lib/server/rouletteChain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The wheel as the chain shows it: slices, odds, and — once the round has closed
// and its beacon block is finalized — the winner.
//
// **This endpoint is a convenience, never an authority.** Everything it returns
// is recomputable from the announcement and a public RPC url, which is the point
// of the game; we answer here only so a viewer's browser does not have to walk a
// hundred transactions on a rate-limited endpoint. If this route lied, the
// verification page would disagree with it in public.
//
// Rate-limited tightly because each call walks the chain: it is the one read in
// the app that costs real upstream requests.
export async function GET(req: NextRequest) {
  if (!allow(req, "roulette-wheel", 30, 10)) return NextResponse.json({ error: "slow down" }, { status: 429 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("round");
  if (!id) return NextResponse.json({ error: "round required" }, { status: 400 });

  const round = await getRound(id);
  if (!round) return NextResponse.json({ error: "not found" }, { status: 404 });

  try {
    // `?detail=1` adds the per-transaction evidence. Off by default because the
    // public page polls this every few seconds and does not need it; the
    // verification page asks for it once.
    const wheel = await readWheel(round, searchParams.get("detail") === "1");
    if (!wheel) return NextResponse.json({ error: "the stored announcement does not decode" }, { status: 500 });
    return NextResponse.json({ wheel });
  } catch (e) {
    // An RPC that is down or throttled is a transient, and saying so is better
    // than serving an empty wheel that reads as "nobody staked".
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "the chain could not be read" },
      { status: 502 }
    );
  }
}
