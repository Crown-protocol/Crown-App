import { NextRequest, NextResponse } from "next/server";
import { saveGameText, listGameTexts, getProfileOwner } from "@/lib/server/store";
import { verifySignedRequest } from "@/lib/server/auth";
import { allow } from "@/lib/server/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Game texts — the words the canisters refuse to hold (they pin hashes only).
// Writes follow the page's ownership: an owned page accepts only its owner's
// signature; a demo page (owner '') stays open, mock flows keep working.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const handle = searchParams.get("handle");
  if (!handle) return NextResponse.json({ error: "handle required" }, { status: 400 });
  const texts = await listGameTexts(handle, searchParams.get("game") ?? undefined);
  return NextResponse.json({ texts });
}

export async function POST(req: NextRequest) {
  if (!allow(req, "texts-write", 30, 15)) return NextResponse.json({ error: "slow down" }, { status: 429 });

  let b: { id?: string; game?: string; handle?: string; body?: string; escrow?: string; salt?: string };
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  if (!b.id?.trim() || !b.game?.trim() || !b.handle?.trim() || !b.body?.trim()) {
    return NextResponse.json({ error: "id, game, handle, body required" }, { status: 400 });
  }
  if (b.body.length > 2000) return NextResponse.json({ error: "body too long" }, { status: 400 });

  const owner = await getProfileOwner(b.handle);
  if (owner) {
    const signer = await verifySignedRequest(req, "text", b.handle, b);
    if (!signer || signer.pubkey !== owner) {
      return NextResponse.json({ error: "signature of the page owner required" }, { status: 403 });
    }
  }
  const saved = await saveGameText({ id: b.id, game: b.game, handle: b.handle, escrow: b.escrow, body: b.body, salt: b.salt });
  // The id exists but belongs to another page: the signature proved this handle, not that one.
  if (!saved) return NextResponse.json({ error: "this id belongs to another page" }, { status: 409 });
  return NextResponse.json({ ok: true });
}
