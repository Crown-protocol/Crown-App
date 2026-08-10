// Signing in to the personal space. There are no accounts, passwords or a server: the wallet is
// the login — you're the owner of a page if you hold the wallet its payouts go to. That check is
// UX, not security (localStorage is editable by hand); the real one lands with cheer-app/api.

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
