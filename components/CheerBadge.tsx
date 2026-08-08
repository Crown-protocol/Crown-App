import type { SVGProps } from "react";

// The Cheer brand mark: a hexagon filled with the site's accent gradient (--grad-top → near-white,
// the same ramp as primary buttons — see docs/front.md "Accent gradient"), a thin inset outline,
// and the cheer cut out of it in the page's own dark. Self-contained: the gradient is baked in, so
// the mark looks identical anywhere (nav, footer, favicon) without inheriting currentColor.
//
// `outline` mode draws the SAME shapes as a thin light stroke with no gradient fill — used as the
// "empty vessel" behind the fundraiser fill, so an unfilled cheer reads as a clean outline, not a
// dark stump.
//
// The gradient id is fixed rather than useId()-generated on purpose: every instance defines the
// SAME gradient, so first-match resolution renders each one correctly, and the mark stays a plain
// server component (no client JS for a logo).
const INK = "#141318"; // --bg-0: the cheer reads as a hole punched through to the page
const HEX = "M24 1.5 44.5 13.25 44.5 34.75 24 46.5 3.5 34.75 3.5 13.25Z";
const HEX_INSET = "M24 5.6 40.9 15.3 40.9 32.7 24 42.4 7.1 32.7 7.1 15.3Z";
const CHEER = "M12.6 32.4 14.2 19.4 19.3 26.2 24 14.6 28.7 26.2 33.8 19.4 35.4 32.4C29.6 34.6 18.4 34.6 12.6 32.4Z";

export function CheerBadge({ size = 30, outline = false, ...props }: { size?: number; outline?: boolean } & SVGProps<SVGSVGElement>) {
  if (outline) {
    // Empty vessel: hexagon + cheer as a single hairline, faint accent so it stays on-brand.
    const stroke = "rgba(196,183,250,0.55)";
    return (
      <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden {...props}>
        <path d={HEX_INSET} fill="none" stroke={stroke} strokeWidth="1.4" strokeLinejoin="round" />
        <path d={CHEER} fill="none" stroke={stroke} strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx="14.2" cy="17.6" r="1.7" fill="none" stroke={stroke} strokeWidth="1.1" />
        <circle cx="24" cy="12.8" r="1.9" fill="none" stroke={stroke} strokeWidth="1.1" />
        <circle cx="33.8" cy="17.6" r="1.7" fill="none" stroke={stroke} strokeWidth="1.1" />
      </svg>
    );
  }

  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden {...props}>
      <defs>
        <linearGradient id="cheer-badge-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8B7CF6" />
          <stop offset="100%" stopColor="#F4F2FE" />
        </linearGradient>
      </defs>

      {/* hexagon body */}
      <path d={HEX} fill="url(#cheer-badge-grad)" />
      {/* thin outline, inset from the edge */}
      <path d={HEX_INSET} fill="none" stroke={INK} strokeWidth="1.4" strokeLinejoin="round" />

      {/* cheer: three spikes, balls on the tips, swooped base */}
      <path d={CHEER} fill={INK} />
      <circle cx="14.2" cy="17.6" r="2.4" fill={INK} />
      <circle cx="24" cy="12.8" r="2.7" fill={INK} />
      <circle cx="33.8" cy="17.6" r="2.4" fill={INK} />
      {/* the light crescent under the cheer — a sliver of the gradient showing through */}
      <path d="M14.4 30.6C20 33 28 33 33.6 30.6 28 31.9 20 31.9 14.4 30.6Z" fill="url(#cheer-badge-grad)" />
    </svg>
  );
}
