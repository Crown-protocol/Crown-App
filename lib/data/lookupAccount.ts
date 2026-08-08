import type { Profile } from "./types";

// The result of "does this wallet already have an account?".
//   { status: "found" }   — the DB returned the page this wallet owns.
//   { status: "none" }    — the server answered, and this wallet owns nothing → registration.
//   { status: "error" }   — we could NOT ask (offline, 5xx, rate-limited, bad JSON).
// "error" must NEVER be treated as "none": sending an existing creator into /create lets them
// re-register their handle and overwrite their own live page (tiers, game configs, design), or strand
// them on a second page that permanently shadows the first.
export type AccountLookup =
  | { status: "found"; profile: Profile }
  | { status: "none" }
  | { status: "error" };

// Asks the Cheer DB (/api/profiles/me) for the page this wallet OWNS. Retries a couple of times on
// transient failures before giving up, because a single flaky request must not change where the user
// is routed. Never throws.
export async function lookupAccountByOwner(address: string | undefined | null): Promise<AccountLookup> {
  const owner = (address || "").trim();
  if (!owner) return { status: "error" };

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`/api/profiles/me?owner=${encodeURIComponent(owner)}`, { cache: "no-store" });
      if (res.ok) {
        const body = (await res.json()) as { profile?: Profile | null };
        return body?.profile ? { status: "found", profile: body.profile } : { status: "none" };
      }
      // 4xx that isn't rate-limiting means the request itself was refused — retrying won't help.
      if (res.status !== 429 && res.status < 500) return { status: "error" };
    } catch {
      // network hiccup — fall through to the retry
    }
    if (attempt < 2) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }
  return { status: "error" };
}
