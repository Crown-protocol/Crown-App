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
  | { type: "entry"; id: string; entry: Record<string, unknown> }
  | { type: "add"; delta: number }
  | { type: "mergeById"; list: { id: string }[] }
  | { type: "replace"; value: unknown };

const POLL_MS = 3000;
const EVENT = "crown-gamesync";

// crown-fundraiser-collected is stored as a bare number string; everything else as JSON.
function toStorage(k: string, v: unknown): string {
  return k === "crown-fundraiser-collected" ? String(v) : JSON.stringify(v);
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
  try {
    const r = await fetch(`/api/gamestate?scope=${encodeURIComponent(scope)}`);
    if (!r.ok) return false;
    const { entries } = (await r.json()) as { entries: Record<string, unknown> };
    let changed = false;
    for (const [k, v] of Object.entries(entries ?? {})) {
      if (adopt(scope, k, v)) changed = true;
    }
    return changed;
  } catch {
    return false;
  }
}

// Mount one per page (or per visible session scope). Returns a nonce that bumps
// whenever a pull or an op response changed this scope's localStorage — put it
// in the deps of whatever effect reads the stores, and the page re-renders with
// the other viewers' actions.
export function useGameSync(scope: string | null): number {
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!scope) return;
    let dead = false;

    const bump = () => {
      if (!dead) setNonce((n) => n + 1);
    };
    const onEvent = (e: Event) => {
      if ((e as CustomEvent).detail?.scope === scope) bump();
    };
    window.addEventListener(EVENT, onEvent);

    void pullScope(scope).then((changed) => changed && bump());
    const t = setInterval(() => {
      void pullScope(scope).then((changed) => changed && bump());
    }, POLL_MS);

    return () => {
      dead = true;
      clearInterval(t);
      window.removeEventListener(EVENT, onEvent);
    };
  }, [scope]);

  return nonce;
}
