"use client";

import styles from "./RulesSummary.module.css";

// One plain sentence spelling out what the numbers above actually add up to.
//
// The rules tab is where the money lives, but it's a column of abstract figures: "min bid $5,
// bidding 24h, perform 48h" never says what a viewer will experience. This restates the same
// settings as the deal the maker is offering, and it updates as they turn the knobs — so you can
// see the consequence of a change before anyone's money is on it.
export function RulesSummary({ children }: { children: React.ReactNode }) {
  return (
    <p className={styles.summary}>
      <span className={styles.label}>In practice</span>
      {children}
    </p>
  );
}

// ── Duration wording ────────────────────────────────────────────────────────────────────────
// The configs store raw hours/minutes/days; a summary that reads "48 hours" where the maker
// picked "2 days" would look like a different setting. These round to the unit a person would
// say out loud, and never pluralise "1 days".

export function hoursText(h: number): string {
  if (h >= 24 && h % 24 === 0) {
    const d = h / 24;
    if (d === 7) return "a week";
    return d === 1 ? "a day" : `${d} days`;
  }
  return h === 1 ? "an hour" : `${h} hours`;
}

export function daysText(d: number): string {
  if (d === 1) return "a day";
  if (d === 7) return "a week";
  if (d === 14) return "2 weeks";
  if (d === 30) return "a month";
  return `${d} days`;
}

export function minutesText(m: number): string {
  if (m >= 60 && m % 60 === 0) {
    const h = m / 60;
    return h === 1 ? "an hour" : `${h} hours`;
  }
  return `${m} min`;
}
