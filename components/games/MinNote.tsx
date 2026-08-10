"use client";

import { useState } from "react";
import type { Floor } from "@/lib/data/floors";
import styles from "./MinNote.module.css";

// The minimum, shown only when it is in the way.
//
// It used to sit under every amount field permanently. That is the wrong trade:
// a rule repeated to everyone who is already following it is noise, and noise is
// what people learn to skip — including on the one screen where the number
// matters. So nothing renders until the amount is actually short, and then the
// line appears with the figure and, when the floor is the network's rather than
// the creator's, the reason it exists.
//
// `role="status"` so a screen reader hears it arrive; it is a live answer to
// something the person just typed, not a page landmark.
export function MinNote({ floor, amount, className }: { floor: Floor; amount?: number; className?: string }) {
  const short = typeof amount === "number" && amount > 0 && amount < floor.amount;
  if (!short) return null;
  return (
    <div className={`${styles.note}${className ? ` ${className}` : ""}`} role="status">
      {floor.short}
    </div>
  );
}

/**
 * The cabinet's half of the same idea: a knob cannot be set below the network's
 * floor, so the input clamps — and the only moment worth explaining that is the
 * moment it happens.
 *
 * Returns the clamp to wrap `onCommit` with, plus the line to render under the
 * field (null until someone actually tries to go lower).
 */
export function useFloorClamp(floorAmount: number, note: string) {
  const [bumped, setBumped] = useState(false);
  const clamp = (n: number) => {
    const raised = Math.max(floorAmount, n);
    setBumped(raised !== n);
    return raised;
  };
  return { clamp, bumpNote: bumped ? note : null };
}

/** The line the cabinet shows after a clamp. Same styling as the viewer's. */
export function FloorBump({ note }: { note: string | null }) {
  if (!note) return null;
  return (
    <div className={styles.note} role="status">
      {note}
    </div>
  );
}
