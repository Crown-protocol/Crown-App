import { NextRequest, NextResponse } from "next/server";
import nacl from "tweetnacl";
import { PublicKey } from "@solana/web3.js";
import { saveIntent } from "@/lib/server/store";
import { allow } from "@/lib/server/ratelimit";
import { AUTH_WINDOW_SECONDS } from "@/lib/chain/authMessage";
import { paidOurFee } from "@/lib/server/submitter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The donor's own words for a tx they just sent: {signature, handle, name?, message?, source?}.
// These decorate the Settled row the indexer mirrors from the chain — the money itself is never
// touched here, and a made-up tx signature decorates nothing that exists.
//
// But "can't invent money" is not the same as "can't lie about someone else's". A tx signature is
// PUBLIC the moment it lands on chain, and this route used to accept an intent for any signature
// from anyone: an attacker watching the mempool could post first and, because saveIntent is
// first-writer-wins (ON CONFLICT DO NOTHING), permanently attach their own name and message to a
// stranger's donation. That text then shows up in the creator's feed, their Telegram card, and
// their Streamlabs alert as if the donor had written it.
//
// So the sender must now prove they hold the wallet that paid: a plain ed25519 signature over
// `cheer-app:intent:<txSignature>:<ts>:-`, made by the donor's own key. Only the payer can produce
// it, it is bound to that one transaction, and it expires with the auth window so a captured
// message can't be replayed later. Nothing here reaches the chain or any contract — the wallet
// signs a message, not a transaction.
export async function POST(req: NextRequest) {
  if (!allow(req, "intent-write", 30, 15)) return NextResponse.json({ error: "slow down" }, { status: 429 });

  let body: {
    signature?: string;
    handle?: string;
    name?: string;
    message?: string;
    source?: string;
    payer?: string;
    ts?: number;
    proof?: string;
    preamble?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const signature = (body.signature ?? "").trim();
  const handle = (body.handle ?? "").trim();
  if (!signature || signature.length > 120 || !handle) {
    return NextResponse.json({ error: "signature and handle required" }, { status: 400 });
  }

  const payer = (body.payer ?? "").trim();
  const proof = (body.proof ?? "").trim();
  const ts = body.ts;
  if (!payer || !proof || typeof ts !== "number") {
    return NextResponse.json({ error: "payer, ts and proof required" }, { status: 401 });
  }

  // Freshness: an old proof must not decorate a new donation.
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > AUTH_WINDOW_SECONDS) {
    return NextResponse.json({ error: "stale request" }, { status: 401 });
  }

  // The canonical line is rebuilt here rather than taken from the request: a caller who supplies
  // both the text and its signature proves only that they can sign something, not that they meant
  // this donation.
  //
  // The wallet shows a human preamble above that line (see DataProvider) — a bare machine string
  // reads as "why is this asking me to sign gibberish?". Only the preamble is caller-supplied, so
  // it is length-capped and the canonical tail is what actually binds the signature.
  const canonical = `cheer-app:intent:${signature.toLowerCase()}:${ts}:-`;
  const preamble = typeof body.preamble === "string" ? body.preamble.slice(0, 400) : "";
  let ok = false;
  try {
    const key = new PublicKey(payer).toBytes();
    const sigBytes = Uint8Array.from(Buffer.from(proof, "base64"));
    // Accept either form: with the preamble the wallet displayed, or the bare canonical line.
    ok =
      nacl.sign.detached.verify(new TextEncoder().encode(preamble + canonical), sigBytes, key) ||
      nacl.sign.detached.verify(new TextEncoder().encode(canonical), sigBytes, key);
  } catch {
    ok = false;
  }
  if (!ok) return NextResponse.json({ error: "bad proof" }, { status: 401 });

  // The words are the paid part of the product. A donation that went straight
  // through the splitter for 0% is a real donation and arrives in full — it just
  // carries nothing of ours: no name, no message, no alert, no book entry we
  // bought. Enforced here rather than only in the form, because the form is not
  // the thing an attacker uses.
  //
  // Read from the chain, so it is the transaction that decides and not the caller.
  if (!(await paidOurFee(signature))) {
    return NextResponse.json(
      { error: "this donation didn't include the service fee, so it can't carry a name or message" },
      { status: 402 }
    );
  }

  await saveIntent({
    signature,
    handle,
    donorName: body.name?.trim().slice(0, 60) || undefined,
    message: body.message?.trim().slice(0, 300) || undefined,
    source: body.source?.trim().slice(0, 20) || undefined,
  });
  return NextResponse.json({ ok: true });
}
