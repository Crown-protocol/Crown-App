import { NextRequest, NextResponse } from "next/server";
import nacl from "tweetnacl";
import { PublicKey } from "@solana/web3.js";
import { allow } from "@/lib/server/ratelimit";
import { AUTH_WINDOW_SECONDS } from "@/lib/chain/authMessage";
import { issueSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/session — trade ONE wallet signature for an editing session.
// Body: { pubkey, ts, signature (base64), message } where `message` is exactly the bytes the wallet
// signed (the human-readable sign-in text). We verify the signature against the pubkey, check the
// message really is a Crown login for that pubkey and is fresh, then set the session cookie.
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
  // Freshness: an old signature must not buy a new session.
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > AUTH_WINDOW_SECONDS) {
    return NextResponse.json({ error: "stale request" }, { status: 401 });
  }
  // The message must be THIS wallet's Crown login, not some other signature replayed here.
  const canonical = `crown-app:login:${pubkey.toLowerCase()}:${ts}:-`;
  if (!message.includes(canonical)) {
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
