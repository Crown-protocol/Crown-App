"use client";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

// Shared animation primitives for the OBS overlays. Kept tiny and dependency-free: overlays run for
// hours inside OBS Browser Sources, so everything here must clean up after itself (rAF cancelled,
// observers disconnected) and never leak across the 1.5s polling re-renders.

// Animates a number toward `target` with an ease-out cubic. Interruptible: a new target mid-flight
// starts from the currently DISPLAYED value, not the previous target, so bursts never snap.
export function useCountUp(target: number, dur = 600): number {
  const [display, setDisplay] = useState(target);
  const shown = useRef(target); // what's actually on screen right now
  const raf = useRef(0);

  useEffect(() => {
    const from = shown.current;
    if (from === target) return;
    const t0 = performance.now();
    cancelAnimationFrame(raf.current);
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = from + (target - from) * eased;
      shown.current = v;
      setDisplay(v);
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target, dur]);

  return display;
}

// Increments whenever `v` changes — use as a React key to re-trigger a one-shot CSS animation
// ("pop" the amount, flash a row) without manual class juggling.
export function useChangeNonce(v: unknown): number {
  const [n, setN] = useState(0);
  const prev = useRef(v);
  useEffect(() => {
    if (prev.current !== v) {
      prev.current = v;
      setN((x) => x + 1);
    }
  }, [v]);
  return n;
}

// FLIP for reorderable lists (top donors, leaderboards). Children must carry data-flip-key.
// On every `dep` change: rows that moved slide from their old offsetTop to the new one; brand-new
// rows enter with a small slide+fade. Uses the Web Animations API so no CSS classes are needed.
export function useFlip(containerRef: RefObject<HTMLElement | null>, dep: unknown): void {
  const positions = useRef<Map<string, number>>(new Map());

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const kids = Array.from(el.children) as HTMLElement[];
    const next = new Map<string, number>();
    for (const k of kids) {
      const key = k.dataset.flipKey;
      if (!key) continue;
      next.set(key, k.offsetTop);
      const prev = positions.current.get(key);
      if (prev !== undefined && prev !== k.offsetTop) {
        k.animate(
          [{ transform: `translateY(${prev - k.offsetTop}px)` }, { transform: "translateY(0)" }],
          { duration: 400, easing: "cubic-bezier(.22,.61,.36,1)" }
        );
      } else if (prev === undefined && positions.current.size > 0) {
        // skip the very first paint (size 0) — only genuinely new rows animate in
        k.animate(
          [{ opacity: 0, transform: "translateX(-16px)" }, { opacity: 1, transform: "none" }],
          { duration: 350, easing: "cubic-bezier(.22,.61,.36,1)" }
        );
      }
    }
    positions.current = next;
  }, [containerRef, dep]);
}
