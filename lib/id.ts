// A random id that works everywhere. `crypto.randomUUID()` throws in an INSECURE context — a page
// served over plain http:// on anything other than localhost — so calling it directly meant "Add
// link" (and page-builder social rows) blew up on a non-localhost http deployment. This uses
// randomUUID when it's available and falls back to a random string otherwise. Ids here are local
// React keys / row identifiers, not security tokens, so the fallback's weaker randomness is fine.
export function safeId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // randomUUID present but threw (insecure context) — fall through.
  }
  // Two base36 chunks give plenty of entropy for de-duping rows in one editor session.
  return `id-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
