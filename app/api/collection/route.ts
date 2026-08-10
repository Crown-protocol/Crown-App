import { NextRequest, NextResponse } from "next/server";
import { allow } from "@/lib/server/ratelimit";
import { getCollectionIntent, saveCollectionIntent } from "@/lib/server/collections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A recipient opening a collection: the signed `create` message, kept until a
// donor's first contribution can pay for its birth proof (see
// lib/server/collections.ts for why the two moments are apart).
//
// No session auth: what makes the row trustworthy is the recipient's own
// signature over the message, verified on save. A row nobody can authorize is
// refused rather than stored.
export async function POST(req: NextRequest) {
  if (!allow(req, "collection-open", 10, 5)) return NextResponse.json({ error: "slow down" }, { status: 429 });

  let body: {
    collectionHex?: string;
    recipient?: string;
    recipientNonce?: string;
    duration?: number;
    goal?: string;
    signedMessage?: string;
    pubkey?: string;
    signature?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const collectionHex = (body.collectionHex ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(collectionHex)) {
    return NextResponse.json({ error: "collectionHex must be 32 bytes of hex" }, { status: 400 });
  }
  if (!body.recipient || !body.pubkey || !body.signature || !body.signedMessage) {
    return NextResponse.json({ error: "recipient, pubkey, signature and signedMessage required" }, { status: 400 });
  }
  if (body.signedMessage.length > 2000) {
    return NextResponse.json({ error: "message too long" }, { status: 400 });
  }

  const ok = await saveCollectionIntent({
    collectionHex,
    recipient: body.recipient.trim(),
    recipientNonce: String(body.recipientNonce ?? "0"),
    duration: Number(body.duration ?? 0),
    goal: String(body.goal ?? "0"),
    signedMessage: body.signedMessage,
    pubkey: body.pubkey.trim(),
    signature: body.signature.trim(),
  });
  if (!ok) return NextResponse.json({ error: "the signature does not authorize this message" }, { status: 401 });
  return NextResponse.json({ ok: true });
}

// Whether a collection is known here and whether it has been materialized —
// what a donor's page needs before it offers to chip in.
export async function GET(req: NextRequest) {
  const id = (req.nextUrl.searchParams.get("id") ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const intent = await getCollectionIntent(id);
  if (!intent) return NextResponse.json({ known: false });
  return NextResponse.json({
    known: true,
    recipient: intent.recipient,
    duration: intent.duration,
    goal: intent.goal,
    materialized: intent.materializedAt !== null,
  });
}
