"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CONFIRM_TITLE, CONFIRM_CANCEL } from "@/lib/data/dangerous";
import styles from "./ConfirmDialog.module.css";

/**
 * A blocking yes/no for actions you can't take back. Deliberately plain: a title, the plain
 * consequence, and two buttons where Cancel is the easy one to hit.
 *
 * Escape and a click on the scrim both cancel — the safe way out is always available.
 *
 * The title defaults to the ONE wording used everywhere in the product (lib/data/dangerous.ts), so
 * every dangerous moment is recognised by shape before it is read. Callers supply the sentence
 * underneath — what happens and to how much money — because a dialog that only ever says "are you
 * sure?" teaches people to click through it without looking.
 */
export function ConfirmDialog({
  title = CONFIRM_TITLE,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
  danger = false,
  busyLabel,
  errorText,
}: {
  title?: string; // defaults to the product-wide CONFIRM_TITLE — override only with a good reason
  body: React.ReactNode;
  confirmLabel: string;
  // May be async: the dialog stays open and shows progress until it resolves, so a destructive action
  // that has to reach the server can't be "confirmed" while it is still failing.
  onConfirm: () => void | Promise<{ ok: boolean; reason?: string } | void>;
  onCancel: () => void;
  danger?: boolean; // red confirm — only for what can't be taken back
  busyLabel?: string; // shown on the confirm button while an async onConfirm is running
  errorText?: (reason?: string) => string; // turns a failure reason into a human sentence
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Rendered into <body> through a portal, NOT where it's written in the tree. A `position: fixed`
  // child is positioned against the nearest ancestor that has a transform/filter/perspective —
  // and the cabinet's `.main` animates in, so its final `transform` frame silently turned this
  // dialog's "fixed" into "absolute inside .main": off-centre, and tall enough to scroll the page.
  // The portal puts it outside anyone's transform, so fixed means the viewport again.
  useEffect(() => setMounted(true), []);

  // Focus lands on Cancel, not on the destructive button — a stray Enter shouldn't wipe anything.
  // preventScroll: focusing normally makes the browser scroll the page to the focused element, and
  // the page behind is still scrollable at that instant — it jumped, which read as the content
  // sliding away under the dialog.
  useEffect(() => {
    if (mounted) cancelRef.current?.focus({ preventScroll: true });
  }, [mounted]);

  // An open dialog owns the screen: freeze the page behind it so it can't scroll away underneath.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, busy]);

  if (!mounted) return null; // no document during SSR

  return createPortal(
    <div className={styles.scrim} onClick={() => { if (!busy) onCancel(); }}>
      <div
        className={styles.card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className={styles.title} id="confirm-title">
          {title}
        </h2>
        <div className={styles.body}>{body}</div>
        {err && (
          <div className="error-note" role="alert">
            {err}
          </div>
        )}
        <div className={styles.actions}>
          <button ref={cancelRef} type="button" className="btn-outline" disabled={busy} onClick={onCancel}>
            {CONFIRM_CANCEL}
          </button>
          <button
            type="button"
            className={danger ? styles.danger : styles.confirm}
            disabled={busy}
            onClick={() => {
              // Lock the dialog on the FIRST click, before anything runs — a fast double-click used to
              // run a synchronous onConfirm (Log out) twice: disconnect twice, two navigations, and a
              // second clearProof with a null address that wiped every wallet's proof on the device.
              setBusy(true);
              const out = onConfirm();
              if (!out || typeof (out as Promise<unknown>).then !== "function") return;
              setErr("");
              void (out as Promise<{ ok: boolean; reason?: string } | void>)
                .then((r) => {
                  // Only a real failure keeps the dialog open; success unmounts it via the caller.
                  if (r && r.ok === false) setErr(errorText ? errorText(r.reason) : "That didn't go through. Try again.");
                })
                .catch(() => setErr(errorText ? errorText("network") : "That didn't go through. Try again."))
                .finally(() => setBusy(false));
            }}
          >
            {busy ? busyLabel || "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
