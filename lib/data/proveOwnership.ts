import nacl from "tweetnacl";
import { PublicKey } from "@solana/web3.js";
import { buildAuthMessage } from "@/lib/chain/authMessage";

// "Prove you hold this wallet" — the one-time sign-in signature. The FIRST time a given wallet logs
// in on THIS device, the wallet is asked to sign a short message; only the holder of the private key
// can produce a signature that verifies against the pubkey, so a matching signature proves ownership.
// We remember success per (address) in localStorage, so subsequent loads on the same device — and the
// silent auto-reconnect — never prompt again. A brand-new device has an empty store, so it asks once
// more, exactly as expected.
const KEY_PREFIX = "crown-login-proof:";

function proofKey(address: string): string {
  return KEY_PREFIX + address;
}

// Already proved ownership of this wallet on this device?
// Has ANY wallet been proved on this device? Used to decide "are we signed in" on a fresh page load,
// where the wallet extension hasn't reconnected yet and there is no address to ask about. A proof is
// only ever written after a verified signature, and log out removes it, so this stays honest — it
// just doesn't require the wallet to be attached at this instant.
export function hasAnyProof(): boolean {
  try {
    return Object.keys(localStorage).some((k) => k.startsWith(KEY_PREFIX) && localStorage.getItem(k) === "1");
  } catch {
    return false;
  }
}

export function hasProof(address: string): boolean {
  try {
    return localStorage.getItem(proofKey(address)) === "1";
  } catch {
    return false;
  }
}

// Mark a wallet as proved WITHOUT a fresh prompt — for flows where it already signed something only
// its private key could have produced (registration signs the page itself). Without this, finishing
// /create asked for a second signature the moment /space loaded.
export function markProved(address: string | null | undefined) {
  if (address) rememberProof(address);
}

function rememberProof(address: string) {
  try {
    localStorage.setItem(proofKey(address), "1");
  } catch {}
}

// Clears the stored proof (used on Log out, so the next sign-in asks again). With no address — e.g.
// the wallet already disconnected itself, so we no longer know which one it was — clears every proof
// on this device, because "log out" must never leave a wallet silently pre-approved here.
export function clearProof(address?: string | null) {
  try {
    if (address) {
      localStorage.removeItem(proofKey(address));
      return;
    }
    Object.keys(localStorage)
      .filter((k) => k.startsWith(KEY_PREFIX))
      .forEach((k) => localStorage.removeItem(k));
  } catch {}
}

export type ProveResult = "ok" | "already" | "declined" | "unavailable";

// Ask the wallet to prove ownership, unless it already did on this device.
//   • "already"     — a valid proof is already stored; no prompt shown.
//   • "ok"          — the wallet signed and the signature verified; proof stored.
//   • "declined"    — the user dismissed the wallet prompt (or it returned nothing).
//   • "unavailable" — the wallet can't sign messages / no address.
// The caller decides what to do with a decline (we let the user stay out rather than fake a login).
// Does the server currently recognise us? Asks the same endpoint the app uses to restore an account
// on load. Treats an unreachable server as "yes" so a network blip doesn't force a signature.
async function hasServerSession(): Promise<boolean> {
  try {
    const res = await fetch("/api/profiles/me", { credentials: "same-origin", cache: "no-store" });
    if (!res.ok) return true;
    const json = (await res.json()) as { profile?: unknown };
    return !!json?.profile;
  } catch {
    return true;
  }
}

export async function proveOwnership(
  address: string | null | undefined,
  signMessage: (msg: Uint8Array) => Promise<Uint8Array | null>
): Promise<ProveResult> {
  if (!address) return "unavailable";
  // Proved on this device already — but the server session may be gone. The proof lives in
  // localStorage indefinitely while the cookie expires after hours, so returning early here left
  // people "signed in" with no session: the landing asks the server who you are, hears nobody, and
  // renders the signed-out page. That is the reload bug.
  //
  // A session can only be minted from a signature (anything weaker would let a browser claim any
  // wallet), so sign again — but silently, and only inside this explicit sign-in flow. Wallets don't
  // re-prompt for a message they've approved for this site, so in practice nothing pops up.
  if (hasProof(address) && (await hasServerSession())) return "already";

  const ts = Math.floor(Date.now() / 1000);
  // The wallet shows this text verbatim, so write it FOR THE PERSON staring at the popup: what it is,
  // that it costs nothing, and which account it proves. The canonical machine line
  // (crown-app:login:<addr>:<ts>:-) stays as the last line so the format is still greppable, but a
  // bare technical string on its own read as "why is my wallet asking me to sign something?".
  const shortAddr = address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
  const human =
    "Crown — sign in\n\n" +
    "Signing proves this wallet is yours. It is not a transaction: no funds move and no fees are paid.\n\n" +
    `Wallet: ${shortAddr}\n` +
    `Site: ${typeof window !== "undefined" ? window.location.host : "crown"}\n\n`;
  const canonical = new TextDecoder().decode(await buildAuthMessage("login", address, ts, null));
  const msg = new TextEncoder().encode(human + canonical);
  const sig = await signMessage(msg);
  if (!sig) return "declined"; // user closed the prompt, or the wallet can't sign

  // Verify locally: the signature must check out against the wallet's own pubkey. This makes the gate
  // a real ownership proof, not just "a prompt appeared".
  let valid = false;
  try {
    valid = nacl.sign.detached.verify(msg, sig, new PublicKey(address).toBytes());
  } catch {
    valid = false;
  }
  if (!valid) return "declined";

  // Trade this one signature for an editing session: the server sets an httpOnly cookie, and from now
  // on ordinary saves (renaming, colours, sliders) authenticate with it instead of a fresh wallet
  // popup per change. Best-effort — if it fails the app still works, saves just fall back to signing.
  try {
    await fetch("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pubkey: address,
        ts,
        message: new TextDecoder().decode(msg),
        signature: btoa(String.fromCharCode(...sig)),
      }),
    });
  } catch {}

  rememberProof(address);
  return "ok";
}
