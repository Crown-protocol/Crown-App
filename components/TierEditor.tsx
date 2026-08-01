"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { Tier } from "@/lib/data/types";
import styles from "./TierEditor.module.css";

// One purple accent only (design charter — no gold, no second hue). The swatches are a monochrome
// purple ramp plus a neutral, so any tier a streamer picks stays on-brand.
const TIER_COLORS = ["#5B5670", "#6F6A84", "#8B7CF6", "#9B8CE6", "#B9A8FF", "#C0B7FA"];
let uid = 0;

export function defaultTiers(): Tier[] {
  return [
    { name: "Newcomer", threshold: 0, color: TIER_COLORS[1] },
    { name: "Regular", threshold: 10, color: TIER_COLORS[3] },
    { name: "VIP", threshold: 100, color: TIER_COLORS[5] },
  ];
}

interface Row {
  id: number;
  name: string;
  threshold: string;
  color: string;
}

function toRows(tiers: Tier[]): Row[] {
  return tiers.map((t) => ({ id: uid++, name: t.name, threshold: String(t.threshold), color: t.color }));
}

function toTiers(rows: Row[]): Tier[] {
  return rows.map((r) => ({ name: r.name, threshold: Math.max(0, Math.round(+r.threshold) || 0), color: r.color }));
}

// FLIP, but gated to a real reorder. The layout effect used to run on EVERY render and
// re-measure every row — so a render mid-animation (each keystroke re-renders the whole
// panel) would sample a row halfway through its slide and yank it again: rows that "crawl"
// forever. Now positions are snapshotted ONCE, synchronously, the instant a reorder is
// requested (capture()); the effect consumes that snapshot and does nothing on any other
// render. One reorder = exactly one animation, no feedback loop.
function useFlip() {
  const els = useRef(new Map<number, HTMLDivElement>());
  const first = useRef<Map<number, DOMRect> | null>(null);

  useLayoutEffect(() => {
    const snapshot = first.current;
    if (!snapshot) return; // not a reorder — leave every row exactly where it is
    first.current = null;
    els.current.forEach((el, id) => {
      const prev = snapshot.get(id);
      if (!prev) return;
      const dy = prev.top - el.getBoundingClientRect().top;
      if (Math.abs(dy) < 1) return;
      el.style.transition = "none";
      el.style.transform = `translateY(${dy}px)`;
      el.getBoundingClientRect(); // force reflow before re-enabling the transition
      requestAnimationFrame(() => {
        el.style.transition = "transform 320ms cubic-bezier(.22,.61,.36,1)";
        el.style.transform = "";
      });
    });
  });

  // Record where every row sits right now — call this immediately before a state change
  // that reorders them, so the effect can slide them from here to their new spots.
  const capture = () => {
    const m = new Map<number, DOMRect>();
    els.current.forEach((el, id) => m.set(id, el.getBoundingClientRect()));
    first.current = m;
  };

  const setRef = (id: number) => (el: HTMLDivElement | null) => {
    if (el) els.current.set(id, el);
    else els.current.delete(id);
  };

  return { setRef, capture };
}

// Name / logo / color per reputation tier. Sorts itself by threshold — reorder on blur,
// animated, so a value typed out of order (e.g. 50 under an existing 100) slides into
// its correct spot instead of just sitting in the wrong place (front.md I §6 tiers).
export function TierEditor({ initialTiers, onChange, max = 8 }: { initialTiers: Tier[]; onChange: (tiers: Tier[]) => void; max?: number }) {
  const [rows, setRows] = useState<Row[]>(() => toRows(initialTiers));
  const { setRef, capture } = useFlip();

  function commit(next: Row[]) {
    setRows(next);
    onChange(toTiers(next));
  }

  function update(id: number, patch: Partial<Row>) {
    commit(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function resort() {
    const sorted = [...rows].sort((a, b) => (+a.threshold || 0) - (+b.threshold || 0));
    // nothing to do (and nothing to animate) if the order is already correct
    if (sorted.every((r, i) => r.id === rows[i].id)) return;
    capture(); // snapshot current positions, then let the effect slide rows into order
    setRows(sorted);
    onChange(toTiers(sorted));
  }

  function addTier() {
    const last = rows[rows.length - 1]?.threshold ?? "0";
    const row: Row = { id: uid++, name: "New tier", threshold: String((+last || 0) + 100), color: TIER_COLORS[rows.length % TIER_COLORS.length] };
    commit([...rows, row]);
  }

  function removeTier(id: number) {
    capture(); // rows below the removed one slide up into the gap
    commit(rows.filter((r) => r.id !== id));
  }

  return (
    <>
      <div className={`tier-list ${styles.list}`}>
        <div className="tier-head">
          <span>Name</span>
          <span>Reputation ≥</span>
          <span>Color</span>
          <span />
        </div>
        {rows.map((t) => (
          <div className="tier-row" key={t.id} ref={setRef(t.id)}>
            <input type="text" placeholder="Tier name" value={t.name} onChange={(e) => update(t.id, { name: e.target.value })} />
            <input
              type="number"
              min={0}
              value={t.threshold}
              onChange={(e) => update(t.id, { threshold: e.target.value })}
              onBlur={resort}
            />
            <input type="color" className="tier-swatch" aria-label={`${t.name || "Tier"} color`} value={t.color} onChange={(e) => update(t.id, { color: e.target.value })} />
            <button type="button" className="rm" aria-label="Remove tier" onClick={() => removeTier(t.id)}>
              ✕
            </button>
          </div>
        ))}
      </div>
      {rows.length < max && (
        <button className="btn-outline" type="button" style={{ alignSelf: "flex-start" }} onClick={addTier}>
          + Add tier
        </button>
      )}
    </>
  );
}
