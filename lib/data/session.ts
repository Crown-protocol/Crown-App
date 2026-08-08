// Signing in to the personal space. There are no accounts, passwords or a server: the wallet is
// the login — you're the owner of a page if you hold the wallet its payouts go to. That check is
// UX, not security (localStorage is editable by hand); the real one lands with cheer-app/api.

// The payout address a page gets when it's created in demo mode. A valid-shaped base58 pubkey
// (decodes to 32 bytes) so nothing downstream chokes on it, but a vanity pattern nobody holds a
// key for — a demo page could never be unlocked by matching a real wallet, so those pages sign
// in via the demo session below instead of being locked out forever.
export const DEMO_ADDRESS = "CrownDemo1111111111111111111111111111111111" as const;

export function isDemoAddress(address: string): boolean {
  return !address || address === DEMO_ADDRESS;
}

// The platform owner's wallet. The one, and only, address that may reach the ops/admin panel from
// the UI. EXACT base58 compare (case-sensitive) — same rule as walletOwns. This is a UX gate, not
// a security boundary: the real /admin authorisation is enforced server-side; hiding the entry just
// keeps every other visitor from ever seeing it.
export const OWNER_ADDRESS = "CiGwBL4C16a2LU17jXcVAeuioFLyPeF9BdNWQxqQV8Ue" as const;

export function isOwnerAddress(address: string | null | undefined): boolean {
  return !!address && address === OWNER_ADDRESS;
}

// Does this wallet own this page? EXACT compare — base58 is case-sensitive
// (lowercasing corrupts Solana addresses; that was fine for hex, fatal here).
export function walletOwns(walletAddress: string | undefined, pageAddress: string): boolean {
  if (!walletAddress || !pageAddress) return false;
  return walletAddress === pageAddress;
}

// ---- demo session ----
// The way into a demo page (and any page while the app runs on mock data): an explicit,
// labelled "I'm just looking around" sign-in. Lives in localStorage so a reload keeps you in,
// exactly like staying logged in; Log out clears it.

const KEY = "cheer-demo-session";

// The `storage` event only fires in OTHER tabs, never the one that made the change — so a component
// in this same tab (e.g. the header) wouldn't hear a start/end. Dispatch our own event too, so any
// in-tab listener (useSignedIn) re-reads immediately when you sign in or log out.
export const DEMO_SESSION_EVENT = "cheer-demo-session-change";
function announceDemoChange() {
  try {
    window.dispatchEvent(new Event(DEMO_SESSION_EVENT));
  } catch {}
}

export function readDemoSession(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function startDemoSession() {
  try {
    localStorage.setItem(KEY, "1");
  } catch {}
  announceDemoChange();
}

export function endDemoSession() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
  announceDemoChange();
}
