"use client";

import { useId } from "react";

// The fundraiser's central figure: a cheer "vessel" filled bottom-up by collected/goal.
// Fill is the site's accent gradient (--accent at the top → near-white at the bottom, the same
// vertical gradient buttons use — see docs/design.md "Accent gradient"), not flat white or gold.
// Shared by the builder preview and the public page; useId keeps the def ids unique per instance.
export function CheerFill({ pct, size = 96 }: { pct: number; size?: number }) {
  const id = useId();
  const gradId = `${id}-grad`;
  const ghostId = `${id}-ghost`;
  const top = 8;
  const bottom = 41;
  const h = (bottom - top) * Math.min(1, Math.max(0, pct));
  const cheer = "M6 41 L6 14 L16 24 L24 8 L32 24 L42 14 L42 41 Z";
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <defs>
        <clipPath id={id}>
          <path d={cheer} />
        </clipPath>
        {/* Anchored to the cheer's own bounds (userSpaceOnUse), so the gradient reads the same
            regardless of how high the fill has risen — --accent at the crest, near-white at the base. */}
        <linearGradient id={gradId} x1="0" y1={top} x2="0" y2={bottom} gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--accent)" />
          <stop offset="100%" stopColor="#F4F2FE" />
        </linearGradient>
        {/* the same gradient, dimmed — the "still to go" part reads as one cheer lit to pct,
            not a grey shape sitting on a white one */}
        <linearGradient id={ghostId} x1="0" y1={top} x2="0" y2={bottom} gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#F4F2FE" stopOpacity="0.22" />
        </linearGradient>
      </defs>
      {/* the whole cheer at low intensity — the vessel — then the bright fill rises over it */}
      <path d={cheer} fill={`url(#${ghostId})`} />
      <rect
        x="0"
        y={bottom - h}
        width="48"
        height={h}
        clipPath={`url(#${id})`}
        fill={`url(#${gradId})`}
        style={{ transition: "y .6s var(--ease), height .6s var(--ease)" }}
      />
      <path d={cheer} fill="none" stroke="rgba(235,233,244,0.45)" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}
