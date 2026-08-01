"use client";

import { useEffect, useId, useRef, useState } from "react";
import styles from "./HelpTip.module.css";

// A small "?" next to a label. The explanation the owner cut from the page lives in here instead:
// out of the way when you know the field, one hover away when you don't.
//
// Hover alone would strand touch screens and keyboards, so the button opens on hover, on focus and
// on tap/click, and closes on Escape or an outside tap. It's a real <button> with the tip wired
// through aria-describedby, so a screen reader announces the field and its explanation together.
export function HelpTip({ text, label = "What's this?" }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span
      className={styles.wrap}
      ref={wrapRef}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className={styles.dot}
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        ?
      </button>
      {open && (
        <span className={styles.pop} id={id} role="tooltip">
          {text}
        </span>
      )}
    </span>
  );
}
