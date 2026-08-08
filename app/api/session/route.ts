import { NextRequest, NextResponse } from "next/server";
import nacl from "tweetnacl";
import { PublicKey } from "@solana/web3.js";
import { allow } from "@/lib/server/ratelimit";
import { AUTH_WINDOW_SECONDS } from "@/lib/chain/authMessage";
import { issueSessionToken, consumeSignature, SESSION_COOKIE, sessionCookieOptions } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/session — trade ONE wallet signature for an editing session.
// Body: { pubkey, ts, signature (base64), message } where `message` is exactly the bytes the wallet
// signed (the human-readable sign-in text). We verify the signature against the pubkey, check the
// message really is a Cheer login for that pubkey and is fresh, then set the session cookie.
// This is what stops the wallet from popping up on every gradient tweak: edits authenticate with the
// cookie instead of a fresh signature.
export async function POST(req: NextRequest) {
  if (!allow(req, "session", 30, 10)) return NextResponse.json({ error: "slow down" }, { status: 429 });

  let body: { pubkey?: string; ts?: number; signature?: string; message?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const { pubkey, ts, signature, message } = body;
  if (!pubkey || !signature || !message || typeof ts !== "number") {
    return NextResponse.json({ error: "pubkey, ts, message and signature required" }, { status: 400 });
  }
  // Freshness: the signature must be recent. Bound BOTH directions, not Math.abs — a `ts` in the
  // future is not "fresh", it's a client whose clock is wrong or a crafted value trying to widen the
  // replay window. Allow a small forward skew (clocks drift), reject a stale one past the auth window.
  const skew = Date.now() / 1000 - ts;
  if (!Number.isFinite(ts) || skew > AUTH_WINDOW_SECONDS || skew < -60) {
    return NextResponse.json({ error: "stale request" }, { status: 401 });
  }
  // The message must be THIS wallet's Cheer login, not some other signature replayed here. The client
  // signs a human-readable preamble followed by the canonical machine line (see proveOwnership.ts), so
  // the canonical is the message's SUFFIX — check it with endsWith, not includes(). A bare includes()
  // would accept a signature over any longer text that merely embeds the line somewhere in the middle
  // (e.g. an unrelated dApp blob with this pasted in), letting that signature be replayed here to mint
  // a Cheer session. Anchoring to the end closes that: nothing can end in this exact line without being
  // a Cheer login for this pubkey at this ts.
  const canonical = `cheer-app:login:${pubkey.toLowerCase()}:${ts}:-`;
  if (!message.endsWith(canonical)) {
    return NextResponse.json({ error: "message mismatch" }, { status: 401 });
  }

  let ok = false;
  try {
    ok = nacl.sign.detached.verify(
      new TextEncoder().encode(message),
      Uint8Array.from(Buffer.from(signature, "base64")),
      new PublicKey(pubkey).toBytes()
    );
  } catch {
    ok = false;
  }
  if (!ok) return NextResponse.json({ error: "bad signature" }, { status: 401 });

  // Replay protection: this exact signature may mint a session ONCE. A captured request body replayed
  // within the freshness window is rejected here. Record it until it goes stale (ts + auth window).
  const fresh = await consumeSignature(signature, ts + AUTH_WINDOW_SECONDS);
  if (!fresh) return NextResponse.json({ error: "signature already used" }, { status: 401 });

  const token = issueSessionToken(pubkey);
  if (!token) return NextResponse.json({ error: "sessions unavailable" }, { status: 503 });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
  return res;
}

// DELETE /api/session — drop the editing session (Log out).
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions, maxAge: 0 });
  return res;
}
