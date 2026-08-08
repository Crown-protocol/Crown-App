"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./ObsGuideModal.module.css";

// The "add a widget to OBS" how-to as a centred modal over the site (same feel as the wallet modal).
// Kept behind the Widgets tab's "?" so the tab stays clean; portalled to <body> so nothing clips it.
const STEPS: { title: string; body: ReactNode }[] = [
  { title: "Copy the widget's link", body: <>On the widget's card, hit <b>Copy URL</b>.</> },
  {
    title: "Add a Browser source",
    body: (
      <>
        In OBS or Streamlabs Desktop: <b>Sources</b> → <b>+</b> → <b>Browser</b> → <b>OK</b>.
      </>
    ),
  },
  { title: "Paste the link", body: <>Drop it into the <b>URL</b> field.</> },
  {
    title: "Set the size",
    body: (
      <>
        Match <b>Width × Height</b> to the card's <b>OBS …</b> chip — click it to copy.
      </>
    ),
  },
  {
    title: "That's it",
    body: (
      <>
        Hit <b>OK</b>. It sits over your stream — transparent background, live on every donation.
        Works the same in OBS Studio and Streamlabs Desktop.
      </>
    ),
  },
];

function MonitorGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="2.5" y="4" width="19" height="12.5" rx="2.2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M9 20h6M12 16.5V20" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="12" cy="10.25" r="2.4" fill="currentColor" />
    </svg>
  );
}

export function ObsGuideModal({ onClose }: { onClose: () => void }) {
  // Escape to close + lock the page scroll behind the modal (same contract as WalletModal).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const modal = (
    <div className={styles.overlay} onMouseDown={onClose} role="dialog" aria-modal="true" aria-label="Add a widget to OBS or Streamlabs Desktop">
      <div className={styles.card} onMouseDown={(e) => e.stopPropagation()}>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>

        <div className={styles.head}>
          <span className={styles.icon}>
            <MonitorGlyph />
          </span>
          <div className={styles.headText}>
            <div className={styles.title}>Add a widget to OBS or Streamlabs</div>
            <div className={styles.sub}>~30 seconds · no plugins</div>
          </div>
        </div>

        <ol className={styles.steps}>
          {STEPS.map((s, i) => (
            <li className={styles.step} key={i}>
              <span className={styles.num}>{i + 1}</span>
              <div className={styles.stepText}>
                <div className={styles.stepTitle}>{s.title}</div>
                <div className={styles.stepBody}>{s.body}</div>
              </div>
            </li>
          ))}
        </ol>

        <div className={styles.tip}>
          <b>Rehearse first:</b> flip <b>Demo data</b> for a lively test scene, then re-copy the clean URL for going
          live. <b>Test</b> fires a sample donation so you can watch it react.
        </div>

        <div className={styles.note}>
          Links point at <b>localhost</b> — they work while OBS runs on this computer. A deployed domain makes them work
          from any machine.
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(modal, document.body);
}
