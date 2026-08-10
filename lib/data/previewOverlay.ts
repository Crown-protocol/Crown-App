"use client";

import { useEffect, useState } from "react";
import type { Profile } from "./types";

// ── Unconfirmed edits, visible in the preview only ───────────────────────────────────────────
// The builder stages edits rather than saving them: nothing reaches the live page until Confirm.
// But the preview is an iframe of the REAL page reading the REAL profile, so while you typed, the
// phone/desktop frame kept showing the old text — you couldn't see what you were writing until you
// committed it, which is the wrong order (you commit BECAUSE you saw it).
//
// So the builder posts its staged draft into the iframe and the page paints that on top of the
// profile it fetched. Nothing is written to storage or the server: close the builder, or press
// Discard, and the overlay is simply gone. A viewer's browser never receives these messages, so
// what they see is still only what was confirmed.

export const PREVIEW_MSG = "cheer-preview-draft";

/** What the builder can stage: the per-game draft under its own key, plus profile-level socials. */
export interface PreviewPatch {
  handle: string;
  /** the profile key this game's draft lives under — taskPage / roulette / fundraiser / auction */
  gameKey: "taskPage" | "roulette" | "fundraiser" | "auction";
  draft: Record<string, unknown>;
  socials?: Profile["socials"];
}

/** Builder side: push the current staged draft to the preview iframe. */
export function postPreviewPatch(frame: HTMLIFrameElement | null, patch: PreviewPatch | null) {
  // Same-origin only — the preview is our own page. Never post a draft to a third party.
  frame?.contentWindow?.postMessage({ type: PREVIEW_MSG, patch }, window.location.origin);
}

/**
 * Page side: the staged draft this page should paint on top of its real profile, or null when
 * there is none (every normal visitor). Only listens when framed — a top-level page ignores it.
 */
export function usePreviewPatch(handle: string): PreviewPatch | null {
  const [patch, setPatch] = useState<PreviewPatch | null>(null);

  useEffect(() => {
    // A page opened directly is never a preview; not listening at all is the safer default.
    if (typeof window === "undefined" || window.parent === window) return;
    const key = handle.replace(/^@/, "").toLowerCase();

    const onMsg = (e: MessageEvent) => {
      // Only our own origin, and only from the window that framed us.
      if (e.origin !== window.location.origin || e.source !== window.parent) return;
      const d = e.data as { type?: string; patch?: PreviewPatch | null } | null;
      if (!d || d.type !== PREVIEW_MSG) return;
      const p = d.patch ?? null;
      // A patch addressed to a different page (the builder switched games) must not leak in.
      if (p && p.handle.replace(/^@/, "").toLowerCase() !== key) return;
      setPatch(p);
    };

    window.addEventListener("message", onMsg);
    // Tell the builder we're ready: the iframe finishes loading after the first patch was sent,
    // so without this the very first render would miss whatever was already staged.
    window.parent.postMessage({ type: `${PREVIEW_MSG}:ready` }, window.location.origin);
    return () => window.removeEventListener("message", onMsg);
  }, [handle]);

  return patch;
}

/** Paint a staged draft onto the profile the page fetched. Returns the same object when there's none. */
export function applyPreviewPatch(profile: Profile | null, patch: PreviewPatch | null): Profile | null {
  if (!profile || !patch) return profile;
  const base = profile as unknown as Record<string, unknown>;
  const current = (base[patch.gameKey] ?? {}) as Record<string, unknown>;
  return {
    ...profile,
    [patch.gameKey]: { ...current, ...patch.draft },
    ...(patch.socials ? { socials: patch.socials } : {}),
  } as Profile;
}
