"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./RepDemo.module.css";

// Interactive demo of per-streamer reputation: press a donate chip, watch the number tick up, the
// bar fill, and the rank climb Newcomer → Regular → VIP. Pure client-side, no data layer — this is a
// landing showcase, so the "streamer" here is fictional and the tiers are the mock ones the product ships.
// One purple accent only (design charter — no gold, no second hue). Tiers read as a climb via a
// monochrome purple ramp: dim → full accent, brightest at the top rank.
const TIERS = [
  { name: "Newcomer", from: 0, color: "#6F6A84" },
  { name: "Regular", from: 10, color: "#9B8CE6" },
  { name: "VIP", from: 100, color: "#C0B7FA" },
];
const MAX = TIERS[TIERS.length - 1].from;
const CHIPS = [5, 10, 25];

function tierAt(rep: number) {
  let cur = TIERS[0];
  let next: (typeof TIERS)[number] | null = null;
  for (let i = 0; i < TIERS.length; i++) {
    if (rep >= TIERS[i].from) {
      cur = TIERS[i];
      next = TIERS[i + 1] ?? null;
    }
  }
  return { cur, next };
}

export function RepDemo() {
  const [rep, setRep] = useState(0); // target value
  const [shown, setShown] = useState(0); // animated display value
  const [gain, setGain] = useState(0); // last +N flash
  const raf = useRef<number>();

  // Ease the displayed number toward the target so a donation reads as a climb, not a jump.
  useEffect(() => {
    const start = shown;
    const delta = rep - start;
    if (delta === 0) return;
    const t0 = performance.now();
    const dur = 550;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(Math.round(start + delta * eased));
      if (k < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rep]);

  function donate(amount: number) {
    setRep((r) => Math.min(MAX, r + amount));
    setGain(amount);
  }
  function reset() {
    setGain(0);
    setRep(0);
    setShown(0);
  }

  const { cur, next } = tierAt(shown);
  const pct = next ? Math.min(100, Math.round(((shown - cur.from) / (next.from - cur.from)) * 100)) : 100;
  const atTop = shown >= MAX;

  return (
    <div className={styles.wrap}>
      <div className="card rep-card">
        <div className="rep-title">A viewer&apos;s reputation with you</div>
        <div className="rep-num num">
          {shown}
          <span key={rep} className={`rep-gain num${gain ? " show" : ""}`}>
            +{gain}
          </span>
        </div>
        <div className="rep-level">
          <span className="tier-badge">
            <span className="tier-dot" style={{ background: cur.color }} />
            {cur.name}
          </span>
        </div>
        {next ? (
          <div className="rep-progress">
            <div className="rep-track">
              <div className="rep-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="rep-next">
              {next.from - shown} more to <b>{next.name}</b>
            </div>
          </div>
        ) : (
          <div className="rep-next">
            <b>Top rank reached</b> 👑
          </div>
        )}
      </div>

      <div className={styles.ladder}>
        {TIERS.map((t) => (
          <span key={t.name} className={`${styles.rung} ${shown >= t.from ? styles.rungOn : ""}`}>
            <span className={styles.dot} style={{ background: t.color }} />
            {t.name}
            <span className={styles.from}>${t.from}</span>
          </span>
        ))}
      </div>

      <div className={styles.controls}>
        {CHIPS.map((c) => (
          <button key={c} className={styles.chip} onClick={() => donate(c)} disabled={atTop}>
            Cheer ${c}
          </button>
        ))}
        <button className={styles.reset} onClick={reset} disabled={shown === 0}>
          Reset
        </button>
      </div>
    </div>
  );
}
