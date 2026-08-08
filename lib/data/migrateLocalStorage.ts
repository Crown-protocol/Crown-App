// One-time client-side rename of persisted keys from the crown-* era to cheer-*.
//
// The Crown→Cheer rename moved every localStorage key the app reads (crown-profile → cheer-profile,
// crown-tasks → cheer-tasks, crown-game-sessions → …). The SERVER stores were migrated by
// scripts/migrate-cheer-keys.mjs, but a returning user's BROWSER still holds their data under the old
// crown-* names — the new code reads cheer-* keys, finds nothing, and the person looks logged out
// with their local games/sessions gone (server data is safe, but the local session/registry isn't
// re-fetched until they sign in again). This copies every crown-* key to its cheer-* twin on first
// load so nothing is orphaned.
//
// Idempotent and safe to call on every load: a flag marks it done, and we never overwrite a cheer-*
// key that already exists (fresher wins). Cheap — it runs once, then short-circuits on the flag.

const DONE_FLAG = "cheer-ls-migrated";

export function migrateLocalStorageKeys(): void {
  if (typeof window === "undefined") return; // SSR — no localStorage
  let ls: Storage;
  try {
    ls = window.localStorage;
    if (ls.getItem(DONE_FLAG)) return; // already migrated this browser
  } catch {
    return; // storage disabled (private mode edge) — nothing to migrate
  }

  try {
    // Snapshot the keys first: we mutate the store as we go, and iterating a live Storage while
    // adding keys is undefined behaviour across browsers.
    const keys: string[] = [];
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k && k.startsWith("crown-")) keys.push(k);
    }

    for (const oldKey of keys) {
      const newKey = "cheer-" + oldKey.slice("crown-".length);
      // Don't clobber a cheer-* value the new code already wrote — that one is fresher/correct.
      if (ls.getItem(newKey) !== null) continue;
      const val = ls.getItem(oldKey);
      if (val !== null) ls.setItem(newKey, val);
    }

    ls.setItem(DONE_FLAG, "1");
  } catch {
    // A quota error mid-copy leaves some keys migrated and the flag unset, so the next load retries
    // the rest — the per-key "don't clobber" guard makes that safe.
  }
}
