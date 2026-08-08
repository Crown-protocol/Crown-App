// Fresh-scope markers, in their own module so the per-game stores can check them without
// importing the session registry (which imports the stores — that would be a cycle).
//
// A "fresh" scope belongs to a session created after the first one: it must start EMPTY, so
// every store checks the marker before falling back to its demo seeds.

const FRESH_KEY = "cheer-fresh-scope";

export function markFresh(scope: string) {
  try {
    localStorage.setItem(`${FRESH_KEY}:${scope}`, "1");
  } catch {}
}

export function isFreshScope(scope: string): boolean {
  try {
    return localStorage.getItem(`${FRESH_KEY}:${scope}`) === "1";
  } catch {
    return false;
  }
}
