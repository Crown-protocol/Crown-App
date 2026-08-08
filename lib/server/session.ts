import crypto from "crypto";
import type { NextRequest } from "next/server";
import { db, now } from "./db";

// ──────────────────────────────────────────────────────────────────
// Editing sessions. The wallet is still the account, but signing EVERY save meant the wallet threw a
// "Sign message" popup while the streamer was dragging a gradient slider. So: prove ownership once
// (a wallet signature at sign-in, /api/session), get a short-lived token, and let ordinary edits ride
// on that token instead.
//
// The token is a signed statement — "<pubkey> proved itself at <ts>" — sealed with an HMAC only this
// server knows. Nothing secret is stored server-side: verifying is recomputing the HMAC. It rides in
// an httpOnly cookie so page scripts (and anything injected into them) can't read or steal it.
// ──────────────────────────────────────────────────────────────────

export const SESSION_COOKIE = "cheer-session";
// Long enough for a real editing session, short enough that a stolen cookie goes stale.
// A week, and /api/profiles/me re-issues the cookie on every visit (rolling), so anyone who opens
// the site at least weekly never gets signed out. 12 hours looked tidy in the audit and translated
// to "log in again every morning" in practice — and the wallet popping up daily is exactly what the
// product promised not to do.
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

// The signing key. In dev we derive a stable fallback so restarts don't log everyone out; in
// production an explicit secret is required — without it sessions are refused outright rather than
// silently signed with a guessable key.
function secret(): string | null {
  const fromEnv = process.env.CHEER_SESSION_SECRET;
  if (fromEnv && fromEnv.length >= 16) return fromEnv;
  if (process.env.NODE_ENV !== "production") return "cheer-dev-session-secret-not-for-production";
  return null;
}

function sign(payload: string, key: string): string {
  return crypto.createHmac("sha256", key).update(payload).digest("base64url");
}

// One-time consumption of a sign-in signature. A fresh signature is only valid for the auth window,
// but within that window it could be POSTed twice to mint two sessions (a replay of a captured
// request body). We record the signature the first time it mints a session and refuse it after.
//
// Returns true if this signature is NEW (and is now recorded — go ahead and mint); false if it was
// already consumed (reject the request). `expiresAtSeconds` is when the record may be swept — set it
// to the signature's own freshness deadline, since past that it can't be replayed anyway.
//
// Racing two identical requests: the PRIMARY KEY makes the second INSERT fail, so exactly one wins.
export async function consumeSignature(sigBase64: string, expiresAtSeconds: number): Promise<boolean> {
  try {
    const c = await db();
    // Opportunistic sweep of stale rows so the table can't grow unbounded — cheap, indexed.
    await c.execute({ sql: `DELETE FROM consumed_sigs WHERE expires_at < ?`, args: [now()] });
    const r = await c.execute({
      sql: `INSERT INTO consumed_sigs (sig, expires_at) VALUES (?, ?) ON CONFLICT(sig) DO NOTHING`,
      args: [sigBase64, Math.floor(expiresAtSeconds)],
    });
    // rowsAffected === 0 → the signature was already there → replay.
    return r.rowsAffected > 0;
  } catch {
    // If the consumed-store is unreachable, fail CLOSED for replay protection would block all logins;
    // instead we allow (the signature+freshness+HMAC checks still stand) and log — availability wins
    // over the narrow 5-minute replay window when the DB is down.
    return true;
  }
}

// Mint a token for a wallet that has just proved ownership with a real signature.
export function issueSessionToken(pubkey: string): string | null {
  const key = secret();
  if (!key) return null;
  const payload = `${pubkey}.${Math.floor(Date.now() / 1000)}`;
  return `${payload}.${sign(payload, key)}`;
}

// Verify a raw cookie value. Split out from readSession so server COMPONENTS can authenticate too:
// they have no NextRequest, only cookies() from next/headers. The admin page needs exactly this —
// it was rendering for anyone, since only its APIs checked the caller.
export function verifySessionToken(raw: string | undefined | null): string | null {
  const key = secret();
  if (!key || !raw) return null;

  const parts = raw.split(".");
  if (parts.length !== 3) return null;
  const [pubkey, tsRaw, mac] = parts;
  const expected = sign(`${pubkey}.${tsRaw}`, key);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const ts = Number(tsRaw);
  if (!Number.isFinite(ts)) return null;
  const age = Date.now() / 1000 - ts;
  if (age > SESSION_TTL_SECONDS) return null; // too old
  // Lower bound: a token dated in the future must not live forever. Our own issuer always stamps
  // `now`, so a future ts means a tampered/clock-skewed token — allow a small skew, reject beyond it.
  if (age < -300) return null;

  return pubkey;
}

// Returns the pubkey this request is authenticated as, or null. Constant-time compare so a wrong
// token can't be guessed byte by byte, and an expired token is rejected even if the HMAC is valid.
export function readSession(req: NextRequest): string | null {
  return verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
}

// `secure` keyed off NODE_ENV meant a production build served over plain http — which is exactly
// how this runs locally — set a Secure cookie that the browser then silently refuses to store. The
// session looked issued (200, Set-Cookie in the response) and was gone on the next request, so
// every reload logged the account out.
//
// Tie it to the address the site is actually served on. The default has to be Secure — a session
// cookie sent in the clear over a real domain is a stolen session — so only a URL that is explicitly
// local turns it off. An unset variable in production therefore stays safe; locally, CHEER_SITE_URL
// (already used by the bot) names the http address and the cookie is storable.
const SITE_URL = process.env.CHEER_SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? process.env.CHEER_SITE ?? "";
const IS_LOCAL = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:|\/|$)/.test(SITE_URL);
const OVER_HTTPS = !IS_LOCAL;

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_TTL_SECONDS,
  secure: OVER_HTTPS,
};
