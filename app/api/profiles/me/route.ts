import { NextRequest, NextResponse } from "next/server";
import { getProfileByOwner } from "@/lib/server/store";
import { allow } from "@/lib/server/ratelimit";
import { isValidAddress } from "@/lib/chain/config";
import { readSession, issueSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/profiles/me?owner=<base58 pubkey>
// "Does this wallet already have an account?" — the sign-in lookup. Returns the page this wallet
// OWNS (signed the registration for), or { profile: null } if it has none yet. Read-only and
// unauthenticated: it exposes only what /@handle already shows publicly, keyed by the wallet the
// caller demonstrably connected. The caller decides from the result: profile → log in, null → register.
export async function GET(req: NextRequest) {
  if (!allow(req, "profiles-me", 60, 20)) return NextResponse.json({ error: "slow down" }, { status: 429 });

  // No ?owner= → "who am I according to my session cookie?". This is what restores the account on a
  // reload: being logged in used to live only in localStorage, so clearing site data signed you out
  // while the session cookie was still perfectly valid.
  const explicit = (req.nextUrl.searchParams.get("owner") || "").trim();
  const sessionOwner = explicit ? null : readSession(req);
  const owner = explicit || sessionOwner || "";

  // A malformed address can't own anything — answer "no account" without touching the DB. `session`
  // still reports the truth: an explicit ?owner= lookup says nothing about the caller's own cookie.
  if (!isValidAddress(owner)) return NextResponse.json({ profile: null, session: !!sessionOwner, owner: sessionOwner ?? null });

  const profile = await getProfileByOwner(owner);
  // `session` answers "does the server recognise me?" — separately from "do I have a page". These
  // are different questions: a wallet can hold a valid cookie with no page yet (just registered, or
  // the page was deleted). Folding them together made the client re-ask the wallet to sign on every
  // save, and left it unable to tell a live session from an expired one.
  const res = NextResponse.json({ profile: profile ?? null, session: !!sessionOwner, owner: sessionOwner ?? null });
  // Rolling session: every recognised visit restarts the clock. Without this the cookie died a fixed
  // interval after sign-in no matter how active the person was, and the next reload signed them out.
  // Keyed on the session alone — a page-less owner must keep their session too.
  if (sessionOwner) {
    const fresh = issueSessionToken(sessionOwner);
    if (fresh) res.cookies.set(SESSION_COOKIE, fresh, sessionCookieOptions);
  }
  return res;
}
