import nacl from "tweetnacl";
import { PublicKey } from "@solana/web3.js";
import type { NextRequest } from "next/server";
import { AUTH_WINDOW_SECONDS, buildAuthMessage } from "@/lib/chain/authMessage";
import { getProfileOwner } from "./store";
import { readSession } from "./session";

// ──────────────────────────────────────────────────────────────────
// Wallet-signature auth for mutating APIs. The wallet IS the account
// (Cheer has no passwords), so a mutation is authorized the same way a
// donation is: an ed25519 signature by the owner's key. Headers:
//   x-cheer-pubkey    — signer, base58
//   x-cheer-ts        — unix seconds (freshness window ±AUTH_WINDOW)
//   x-cheer-signature — base64 ed25519 over buildAuthMessage(...)
// ──────────────────────────────────────────────────────────────────

export interface Signer {
  pubkey: string; // base58, verified
}

export async function verifySignedRequest(req: NextRequest, action: string, subject: string, body: unknown): Promise<Signer | null> {
  const pubkey = req.headers.get("x-cheer-pubkey");
  const tsRaw = req.headers.get("x-cheer-ts");
  const sigB64 = req.headers.get("x-cheer-signature");
  if (!pubkey || !tsRaw || !sigB64) return null;

  const ts = Number(tsRaw);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > AUTH_WINDOW_SECONDS) return null;

  let keyBytes: Uint8Array;
  try {
    keyBytes = new PublicKey(pubkey).toBytes();
  } catch {
    return null;
  }

  let sig: Uint8Array;
  try {
    sig = Uint8Array.from(Buffer.from(sigB64, "base64"));
  } catch {
    return null;
  }
  if (sig.length !== 64) return null;

  const msg = await buildAuthMessage(action, subject, ts, body);
  return nacl.sign.detached.verify(msg, sig, keyBytes) ? { pubkey: new PublicKey(keyBytes).toBase58() } : null;
}

// ──────────────────────────────────────────────────────────────────
// Per-handle mutation gate — the SAME ownership model as /api/profiles
// and /api/texts, reused wherever an anonymous caller must not be able to
// act as a streamer (e.g. the whole Telegram subsystem):
//   • real page (owner is a wallet)  → only the owner's signature passes;
//   • demo/unclaimed page (owner ''  → unsigned allowed, so the wallet-less
//     or a page with no DB row)        mock flow keeps working.
// Because an unsigned request can NEVER reach an OWNED handle, a real
// streamer's notifications can't be hijacked or spoofed.
// ──────────────────────────────────────────────────────────────────
export type HandleAuth = { ok: true } | { ok: false; status: number; error: string };

export async function authorizeHandleMutation(
  req: NextRequest,
  action: string,
  handle: string,
  body: unknown
): Promise<HandleAuth> {
  const owner = await getProfileOwner(handle);
  if (!owner) return { ok: true }; // null (no page) or '' (demo) → unsigned OK
  const signer = await verifySignedRequest(req, action, handle, body);
  if (!signer || signer.pubkey !== owner) {
    return { ok: false, status: 403, error: "signature of the page owner required" };
  }
  return { ok: true };
}

// Stricter gate for anything that binds a page to a PERSON's private channel (Telegram links,
// notification targets). authorizeHandleMutation deliberately lets unowned/demo pages through
// unsigned — fine for editing a throwaway demo page, fatal here: anyone could mint a link code for a
// handle nobody had claimed yet, tap /start first, and receive that creator's donation cards
// (amounts, donor names, messages) once they registered. So: an owned page needs its owner, and an
// unowned page can't be bound at all.
export async function authorizeHandleChannel(
  req: NextRequest,
  action: string,
  handle: string,
  body: unknown
): Promise<HandleAuth> {
  const owner = await getProfileOwner(handle);
  if (!owner) {
    return { ok: false, status: 403, error: "register this page before connecting Telegram" };
  }
  const session = readSession(req);
  if (session === owner) return { ok: true };
  const signer = await verifySignedRequest(req, action, handle, body);
  if (!signer || signer.pubkey !== owner) {
    return { ok: false, status: 403, error: "signature of the page owner required" };
  }
  return { ok: true };
}
