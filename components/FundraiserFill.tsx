"use client";

import { CheerBadge } from "./CheerBadge";
import styles from "./FundraiserFill.module.css";

// The fundraiser's central figure — a "vessel" that fills bottom-up as collected/goal rises.
// Two modes:
//   • custom photo (any image the content maker uploads): shown dim + desaturated, with the SAME
//     photo in full colour revealed from the bottom by the collected fraction — it literally fills up.
//   • default (no photo): the Cheer brand mark (the new hexagon badge), filling the same way.
// This is the fundraiser page's own figure and deliberately separate from CheerFill (the cheer-outline
// vessel still used by the hero, overlays and OBS widgets) so changing one never disturbs the others.
export function FundraiserFill({ pct, size = 128, image }: { pct: number; size?: number; image?: string }) {
  const p = Math.min(1, Math.max(0, pct));
  // Reveal the bottom `p` of the full-colour layer by clipping away the top (1 - p).
  const clip = `inset(${((1 - p) * 100).toFixed(2)}% 0 0 0)`;
  const figure = image ? (
    <img src={image} alt="" className={styles.media} draggable={false} />
  ) : (
    <CheerBadge size={size} />
  );
  // The empty layer: for the badge it's a clean outline (not a dark stump); for a photo it's the
  // dimmed/greyed picture so the colour reveal still reads.
  const empty = image ? <img src={image} alt="" className={styles.media} draggable={false} /> : <CheerBadge size={size} outline />;

  return (
    <div
      className={`${styles.fill} ${image ? styles.asPhoto : styles.asBadge}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <div className={styles.dim}>{empty}</div>
      <div className={styles.full} style={{ clipPath: clip }}>
        {figure}
      </div>
      {image && p > 0 && p < 1 && <span className={styles.waterline} style={{ bottom: `${(p * 100).toFixed(2)}%` }} />}
    </div>
  );
}
