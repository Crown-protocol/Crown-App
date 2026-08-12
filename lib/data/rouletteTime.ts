// ──────────────────────────────────────────────────────────────────
// Slots, in the units a person actually has.
//
// Every roulette deadline is a slot number, and a slot number tells a viewer
// nothing. These two turn them into the sentence a page wants — deliberately
// rounded, because ~400ms a slot is itself an approximation and a page that
// prints "3 minutes 12 seconds" from it is claiming a precision the chain does
// not offer.
//
// Shared rather than copied: the panel and the verify page were rounding the
// same number in two places, and two roundings of one deadline eventually
// disagree on screen.
// ──────────────────────────────────────────────────────────────────

/** How long a span of slots lasts. */
export function slotsText(slots: number): string {
  const secs = slots * 0.4;
  // Under a minute and a half the useful unit is seconds: an elimination round
  // knocking one out every 30s was reading as "every 1 minute", which is not a
  // rounding a viewer can act on — they are watching a countdown.
  if (secs < 90) return `${Math.max(5, Math.round(secs / 5) * 5)} seconds`;
  const mins = Math.round(secs / 60);
  if (mins < 1) return "under a minute";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"}`;
  const h = Math.round(mins / 60);
  return `${h} hour${h === 1 ? "" : "s"}`;
}

/** How long ago a slot passed, or `null` if it has not. */
export function agoText(slotsPast: number): string | null {
  if (slotsPast <= 0) return null;
  const mins = Math.round((slotsPast * 0.4) / 60);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const h = Math.round(mins / 60);
  return `${h} hour${h === 1 ? "" : "s"} ago`;
}
