"use client";

import { usd } from "@/lib/money";
import { useEffect, useRef, useState } from "react";
import type { RouletteSuggestion } from "@/lib/data/roulette-mock";
import styles from "./RouletteWheel.module.css";

// On-charter wheel palette: neighbouring dark neutrals stepped far enough apart to read as
// separate slices, no rainbow — the slice SIZE carries the information (share of pot = odds).
// The LEADING slice alone rides the accent gradient, exactly like the catalog poster and the
// primary buttons: one purple splash, everything else calm.
const FILLS = ["#322F40", "#1E1D26", "#3A3550", "#262430", "#2D2B3A"];

/**
 * A suggestion as the wheel draws it.
 *
 * `share` overrides the pool when the size of a slice is not its share of the
 * money: on an elimination round the spin picks who LEAVES, and the chance of
 * leaving falls as the pool rises. Drawing that wheel by pool would show the
 * best-backed slice as the biggest target — the exact opposite of the truth.
 */
export type WheelSlice = RouletteSuggestion & { share?: number };

interface Slice {
  s: WheelSlice;
  start: number; // degrees from the pointer (top), clockwise
  angle: number;
}

function computeSlices(round: WheelSlice[]): { slices: Slice[]; total: number } {
  const weight = (r: WheelSlice) => r.share ?? r.pool;
  const spread = round.reduce((sum, r) => sum + weight(r), 0);
  const total = round.reduce((sum, r) => sum + r.pool, 0);
  let acc = 0;
  const slices = round.map((s) => {
    const angle = spread ? (weight(s) / spread) * 360 : 0;
    const slice = { s, start: acc, angle };
    acc += angle;
    return slice;
  });
  return { slices, total };
}

// 0° = top (where the pointer sits), growing clockwise.
function polar(r: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [100 + r * Math.cos(rad), 100 + r * Math.sin(rad)];
}

function slicePath(start: number, angle: number): string {
  const [x1, y1] = polar(94, start);
  const [x2, y2] = polar(94, start + angle);
  const large = angle > 180 ? 1 : 0;
  return `M100 100 L${x1.toFixed(2)} ${y1.toFixed(2)} A94 94 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
}

function trunc(s: string): string {
  return s.length > 13 ? `${s.slice(0, 12)}…` : s;
}

/**
 * The wheel itself. Slices are proportional to each suggestion's pool — the wheel literally
 * fills up as donations come in, and a slice's size IS its odds. Spinning: bump `spinNonce`
 * with `spinToId` set — the wheel turns a few laps, lands on that suggestion (with a little
 * jitter inside the slice) and calls `onLanded`. `winnerId` dims everyone else after landing.
 */
export function RouletteWheel({
  round,
  spinToId,
  spinNonce = 0,
  onLanded,
  winnerId,
  size = 320,
  compact = false,
  onSliceClick,
}: {
  round: WheelSlice[];
  spinToId?: string | null;
  spinNonce?: number;
  onLanded?: (id: string) => void;
  winnerId?: string | null;
  size?: number;
  compact?: boolean;
  onSliceClick?: (s: RouletteSuggestion) => void;
}) {
  const { slices, total } = computeSlices(round);
  // The accent belongs to the verdict once there is one, and to the biggest pool until then.
  const leadId = winnerId ?? (round.length ? [...round].sort((a, b) => b.pool - a.pool)[0].id : null);
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const handled = useRef(0);
  const slicesRef = useRef(slices);
  slicesRef.current = slices;

  useEffect(() => {
    // A new round resets the parent's nonce to 0. Clear `handled` too, otherwise the next spin's
    // nonce (1) is still ≤ the last round's handled value and the guard below skips it forever —
    // the wheel would stay stuck on "Spinning…". (The wheel doesn't unmount between rounds.)
    if (!spinNonce) { handled.current = 0; return; }
    if (!spinToId || handled.current >= spinNonce) return;
    const slice = slicesRef.current.find((x) => x.s.id === spinToId);
    if (!slice) return;
    handled.current = spinNonce;
    // Land the slice's center under the pointer, with jitter so it doesn't look scripted.
    const jitter = (Math.random() - 0.5) * slice.angle * 0.6;
    const center = (slice.start + slice.angle / 2 + jitter + 360) % 360;
    setRotation((r) => {
      const current = ((r % 360) + 360) % 360;
      const target = (360 - center) % 360;
      const delta = (target - current + 360) % 360;
      return r + 4 * 360 + delta;
    });
    setSpinning(true);
    const t = setTimeout(() => {
      setSpinning(false);
      onLanded?.(spinToId);
    }, 4400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spinNonce, spinToId]);

  // Opened with the verdict already decided (e.g. a reload after the round closed): park the
  // winner under the pointer instantly — replaying the spin on every reload would be theater.
  useEffect(() => {
    if (!winnerId || handled.current > 0) return;
    const slice = slicesRef.current.find((x) => x.s.id === winnerId);
    if (!slice) return;
    const center = (slice.start + slice.angle / 2) % 360;
    setRotation((360 - center) % 360);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [winnerId]);

  return (
    <div className={styles.wrap} style={{ width: size }}>
      <svg viewBox="0 0 200 200" className={styles.svg} aria-hidden>
        <defs>
          {/* userSpaceOnUse + the centre on the rotation axis — keeps the gradient from drifting mid-spin */}
          <radialGradient id="wheel-lead" gradientUnits="userSpaceOnUse" cx="100" cy="100" r="94">
            <stop offset="0%" stopColor="#7A6BE4" />
            <stop offset="55%" stopColor="#8B7CF6" />
            <stop offset="100%" stopColor="#D9D2FC" />
          </radialGradient>
        </defs>
        <g
          className={styles.wheel}
          style={{
            transform: `rotate(${rotation}deg)`,
            transitionDuration: spinning ? "4.2s" : "0s",
          }}
        >
          {total === 0 ? (
            <circle cx="100" cy="100" r="94" className={styles.empty} />
          ) : slices.length === 1 ? (
            <circle
              cx="100"
              cy="100"
              r="94"
              fill="url(#wheel-lead)"
              stroke="#0F0E14"
              strokeWidth="2"
              className={onSliceClick ? styles.clickable : styles.slice}
              onClick={onSliceClick ? () => onSliceClick(slices[0].s) : undefined}
            />
          ) : (
            slices.map((sl, i) => (
              <path
                key={sl.s.id}
                d={slicePath(sl.start, sl.angle)}
                fill={sl.s.id === leadId ? "url(#wheel-lead)" : FILLS[i % FILLS.length]}
                stroke="#0F0E14"
                strokeWidth="2"
                className={`${onSliceClick ? styles.clickable : styles.slice}${winnerId && winnerId !== sl.s.id ? ` ${styles.dimmed}` : ""}`}
                onClick={onSliceClick ? () => onSliceClick(sl.s) : undefined}
              >
                <title>{`${sl.s.title} — ${usd(sl.s.pool)} · ${Math.round((sl.angle / 360) * 100)}%`}</title>
              </path>
            ))
          )}

          {!compact &&
            slices
              // Radial labels need angular room only for the font's height — ~12° is safe.
              // A wheel down to its last slice is labelled outside this group instead:
              // a full-circle label rides the wheel's rotation and ends up upside
              // down, which is how the winner of an elimination round was being
              // announced.
              .filter((sl) => sl.angle >= 12 && slices.length > 1)
              .map((sl) => {
                const mid = sl.start + sl.angle / 2;
                const [lx, ly] = polar(57, mid);
                // Text runs along the radius (center → rim), so it can never poke past it;
                // on the left half it flips so it doesn't stand on its head.
                const rot = mid > 180 ? mid + 90 : mid - 90;
                return (
                  <text
                    key={`t-${sl.s.id}`}
                    x={lx}
                    y={ly}
                    className={`${styles.label}${sl.s.id === leadId ? ` ${styles.labelLead}` : ""}`}
                    transform={`rotate(${rot.toFixed(2)}, ${lx.toFixed(2)}, ${ly.toFixed(2)})`}
                  >
                    {trunc(sl.s.title)}
                  </text>
                );
              })}
        </g>

        {/* The last one standing, named upright: outside the rotating group, so
            the wheel can keep whatever angle its final spin left it at. */}
        {!compact && slices.length === 1 && (
          <text x="100" y="62" textAnchor="middle" className={`${styles.label} ${styles.labelLead}`}>
            {trunc(slices[0].s.title)}
          </text>
        )}

        {/* the rim: a hairline + a soft accent halo just outside it */}
        <circle cx="100" cy="100" r="96.5" className={styles.rim} />
        <circle cx="100" cy="100" r="99" className={styles.rimGlow} />
        {/* the axle: layered hub so the wheel has a physical center */}
        <circle cx="100" cy="100" r="13" className={styles.hubOuter} />
        <circle cx="100" cy="100" r="9" className={styles.hub} />
        <circle cx="100" cy="100" r="3" className={styles.hubDot} />
        {/* the needle: white, with a dark seam so it survives landing on the light slice */}
        <path d="M100 22 L93 2 Q100 -2 107 2 Z" className={styles.pointerSeam} />
        <path d="M100 19 L94.5 3 Q100 0 105.5 3 Z" className={styles.pointer} />
      </svg>
    </div>
  );
}
