"use client";

import { useEffect, useRef, useState } from "react";

// A number field you can actually clear and retype. The old pattern —
//   value={cfg.x} onChange={e => patch({ x: Math.max(1, Math.round(+e.target.value) || 1) })}
// — clamped on every keystroke, so deleting the field snapped it to 1 and "5 → 25" was impossible.
// This holds the raw string while focused (empty is allowed) and only clamps + commits on blur.
export function NumberInput({
  value,
  onCommit,
  min = 1,
  max,
  id,
  className,
  ...rest
}: {
  value: number;
  /**
   * The kept value, plus what was actually typed.
   *
   * The field clamps to `min` before anyone downstream sees the number, which
   * left the cabinet's floor notice unreachable: it compared the value it got
   * against the floor, and that value had already been raised. Handing over the
   * raw figure as well is what lets a caller say "we raised this" — and saying
   * it is the whole point of having a floor in the interface rather than only in
   * the canister.
   */
  onCommit: (n: number, typed: number) => void;
  min?: number;
  max?: number;
  id?: string;
  className?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "onBlur" | "min" | "max">) {
  const [draft, setDraft] = useState(String(value));
  const focused = useRef(false);

  // Keep the field in sync with outside changes, but never while the user is typing in it.
  useEffect(() => {
    if (!focused.current) setDraft(String(value));
  }, [value]);

  function commit() {
    focused.current = false;
    const n = Math.round(Number(draft));
    const clamped = Number.isFinite(n) ? Math.min(max ?? Infinity, Math.max(min, n)) : min;
    onCommit(clamped, Number.isFinite(n) ? n : min);
    setDraft(String(clamped));
  }

  return (
    <input
      {...rest}
      id={id}
      className={className}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      value={draft}
      onFocus={() => { focused.current = true; }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
    />
  );
}
