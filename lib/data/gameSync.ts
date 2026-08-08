"use client";

import { useEffect, useState } from "react";

// ──────────────────────────────────────────────────────────────────
// Client half of the shared game state (lib/server/gameState.ts).
//
// The mini-game stores stay synchronous localStorage readers — this layer keeps
// that localStorage in step with the server so every browser sees one game:
//   • sendOp(): store mutators call this after their local write; the server
//     applies the op (append/delta/replace) and returns the key's full new
//     value, which is adopted back into localStorage verbatim.
//   • useGameSync(): pages mount this per scope — it pulls all synced keys on
//     mount and every POLL_MS, adopts what changed, and bumps a nonce the page
//     puts in its read-effect deps.
// Offline or with the API down everything degrades to exactly the old
// per-browser behaviour: local writes stick, sends fail silently.
// ──────────────────────────────────────────────────────────────────

export type SyncOp =
  | { type: "append"; item: { id: string } & Record<string, unknown>; seed?: unknown[] }
  | { type: "suggest"; title: string; genre: string; dPool: number; dBackers: number }
  // `seed` initialises the server copy with the board the entry was applied to — a demo scope serves
  // its lots from memory, so without it the server holds an entry for a lot it has never seen.
  | { type: "entry"; id: string; entry: Record<string, unknown>; seed?: unknown[] }
  | { type: "add"; delta: number }
  | { type: "mergeById"; list: { id: string }[] }
  | { type: "replace"; value: unknown };

const POLL_MS = 3000;
const EVENT = "cheer-gamesync";

// cheer-fundraiser-collected is stored as a bare number string; everything else as JSON.
function toStorage(k: string, v: unknown): string {
  return k === "cheer-fundraiser-collected" ? String(v) : JSON.stringify(v);
}

function adopt(scope: string, k: string, v: unknown): boolean {
  try {
    const next = toStorage(k, v);
    const cur = localStorage.getItem(`${k}:${scope}`);
    if (cur === next) return false;
    localStorage.setItem(`${k}:${scope}`, next);
    return true;
  } catch {
    return false;
  }
}

// Store mutators fire this after writing localStorage. Fire-and-forget by
// design: a dead server must never block the local (demo) experience.
export function sendOp(scope: string, k: string, op: SyncOp): void {
  if (typeof window === "undefined") return;
  void fetch("/api/gamestate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin", // the owner's session cookie must ride along for `replace` ops (settle/close/refund)
    body: JSON.stringify({ scope, k, op }),
  })
    .then(async (r) => {
      if (!r.ok) return;
      const { v } = (await r.json()) as { v: unknown };
      if (v !== undefined && adopt(scope, k, v)) {
        window.dispatchEvent(new CustomEvent(EVENT, { detail: { scope } }));
      }
    })
    .catch(() => {});
}

export async function pullScope(scope: string): Promise<boolean> {
  return (await pullScopeResult(scope)).changed;
}

/**
 * Like pullScope, but says whether the server was actually REACHED — not just whether anything
 * changed. A failed pull and a pull that found nothing new both mean "changed: false", and callers
 * that gate money on having this run's rules must be able to tell those apart: the first means the
 * rules on screen may not be the ones in escrow, the second means they are.
 */
export async function pullScopeResult(scope: string): Promise<{ ok: boolean; changed: boolean }> {
  try {
    const r = await fetch(`/api/gamestate?scope=${encodeURIComponent(scope)}`);
    if (!r.ok) return { ok: false, changed: false };
    const { entries } = (await r.json()) as { entries: Record<string, unknown> };
    let changed = false;
    for (const [k, v] of Object.entries(entries ?? {})) {
      if (adopt(scope, k, v)) changed = true;
    }
    return { ok: true, changed };
  } catch {
    return { ok: false, changed: false };
  }
}

// Mount one per page (or per visible session scope). Returns a nonce that bumps
// whenever a pull or an op response changed this scope's localStorage — put it
// in the deps of whatever effect reads the stores, and the page re-renders with
// the other viewers' actions.
export function useGameSync(scope: string | null): number {
  return useGameSyncState(scope).nonce;
}

/**
 * Same as useGameSync, plus whether the FIRST pull for this scope has come back.
 *
 * Rules are snapshotted per session and synced like any other key, but `readScopeRules` is
 * synchronous and the pull is not — so until that first answer lands, a page resolves its rules
 * from the maker's current profile defaults instead of the session's. Surfaces that take money use
 * `synced` to hold off until they know they're showing this run's real terms.
 *
 * `synced` flips on the first completed pull whether or not it changed anything, and stays true; a
 * failed pull leaves it false, which is what keeps an offline viewer from bidding under rules that
 * may not be the ones in escrow.
 */
export function useGameSyncState(scope: string | null): { nonce: number; synced: boolean } {
  const [nonce, setNonce] = useState(0);
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    if (!scope) return;
    let dead = false;
    // A new scope has not been pulled yet — never carry the previous one's answer over.
    setSynced(false);

    const bump = () => {
      if (!dead) setNonce((n) => n + 1);
    };
    const onEvent = (e: Event) => {
      if ((e as CustomEvent).detail?.scope === scope) bump();
    };
    window.addEventListener(EVENT, onEvent);

    const pull = () =>
      pullScopeResult(scope).then(({ ok, changed }) => {
        if (dead) return;
        // Reaching the server at all is the signal: this browser now holds whatever the server has
        // for this scope, snapshot included. A failed pull must NOT count — offline is exactly when
        // the rules on screen are least likely to be the ones the session was opened with.
        if (ok) setSynced(true);
        if (changed) bump();
      });

    void pull();
    const t = setInterval(() => void pull(), POLL_MS);

    return () => {
      dead = true;
      clearInterval(t);
      window.removeEventListener(EVENT, onEvent);
    };
  }, [scope]);

  return { nonce, synced };
}
