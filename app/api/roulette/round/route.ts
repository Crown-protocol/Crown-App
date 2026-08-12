import { NextRequest, NextResponse } from "next/server";
import { allow } from "@/lib/server/ratelimit";
import { getRound, listRounds, saveRound } from "@/lib/server/roulette";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A recipient opening a wheel: the canonical announcement bytes and their
// signature.
//
// No session auth, for the same reason as `/api/collection`: what makes the row
// trustworthy is the recipient's own signature over the bytes, verified on save
// and re-verifiable by anyone afterwards. A row nobody can authorize is refused
// rather than stored — and a row that disagrees with its own id cannot exist,
// because the id is the hash of the bytes.
export async function POST(req: NextRequest) {
  // Burst 10, not 5. A refused attempt spends a token too, so the tight burst
  // copied from `collection-open` locked a maker out at the exact moment they
  // were fumbling toward a valid round — five refusals and the sixth try, the
  // one that would have worked, is a 429 instead. Opening a round is signature-
  // gated and rare; the bucket is here for floods, not for beginners.
  if (!allow(req, "roulette-open", 10, 10)) return NextResponse.json({ error: "slow down" }, { status: 429 });

  let body: {
    roundHex?: string;
    handle?: string;
    chain?: string;
    announcement?: string;
    pubkey?: string;
    signature?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const roundHex = (body.roundHex ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(roundHex)) {
    return NextResponse.json({ error: "roundHex must be 32 bytes of hex" }, { status: 400 });
  }
  if (!body.handle || !body.chain || !body.announcement || !body.pubkey || !body.signature) {
    return NextResponse.json(
      { error: "handle, chain, announcement, pubkey and signature required" },
      { status: 400 }
    );
  }
  // 106 bytes of header plus a topic the game caps at 64 — anything longer is
  // not an announcement this client would ever have built.
  if (body.announcement.length > 2 * (106 + 64)) {
    return NextResponse.json({ error: "announcement too long" }, { status: 400 });
  }

  const saved = await saveRound({
    roundHex,
    handle: body.handle.trim(),
    chain: body.chain.trim(),
    announcement: body.announcement,
    pubkey: body.pubkey.trim(),
    signature: body.signature.trim(),
  });
  if (!saved.ok) {
    const status = saved.error === "not-the-owner" ? 403 : saved.error === "exists" ? 409 : 400;
    return NextResponse.json({ error: saved.error }, { status });
  }
  return NextResponse.json({ ok: true, roundHex });
}

// `?id=<round hex>` for one round, `?handle=<handle>` for a page's rounds,
// newest first. Both are public: everything here is already public by design —
// the bytes, the signature and the hash of the two.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (id) {
    const round = await getRound(id);
    return round
      ? NextResponse.json({ round })
      : NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const handle = searchParams.get("handle");
  if (!handle) return NextResponse.json({ error: "id or handle required" }, { status: 400 });
  return NextResponse.json({ rounds: await listRounds(handle) });
}
