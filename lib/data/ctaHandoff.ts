"use client";

import { useEffect, useState } from "react";

// ── The sign-up button hand-off ──────────────────────────────────────────────────────────────
// The landing page ends with a "Create an account" call to action, and the header carries the
// same offer. Scrolled to the bottom, both are on screen at once — the same button twice, which
// reads as a mistake and splits the click.
//
// So they trade places: when the final CTA scrolls into view the header's button retracts (up,
// out of the bar) and the big one takes over; scroll back up and it returns. One offer visible at
// any moment, and the movement makes the connection between them legible rather than jarring.
//
// A tiny event bus rather than context: TopNav sits in a server-rendered layout far above the
// landing page, so there's no common provider to thread state through, and the signal is
// page-local and ephemeral.

const EVENT = "crown-cta-handoff";

let handedOff = false;

/** Called by the landing page as its final CTA enters/leaves the viewport. */
export function setCtaHandoff(next: boolean) {
  if (handedOff === next) return;
  handedOff = next;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: next }));
}

/** True while the page's own big CTA is on screen and the header's copy should stand down. */
export function useCtaHandoff(): boolean {
  const [on, setOn] = useState(false);

  useEffect(() => {
    // Adopt whatever the page already decided before this mounted.
    setOn(handedOff);
    const onEvent = (e: Event) => setOn((e as CustomEvent<boolean>).detail);
    window.addEventListener(EVENT, onEvent);
    return () => window.removeEventListener(EVENT, onEvent);
  }, []);

  // Leaving the page must not strand the header button in its hidden state.
  useEffect(() => () => { handedOff = false; }, []);

  return on;
}
