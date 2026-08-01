"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./SuggestGameModal.module.css";

// "Suggest a mini-game" — a centred modal (same shell/behaviour as the wallet connect modal:
// portalled to <body>, Escape + backdrop close, body scroll locked). Every field is optional; you can
// send with just one filled in.
//
// The idea goes to /api/game-idea, which stores it and pushes a card to the founders' Telegram. It
// used to just show a thank-you and drop what the person wrote on the floor — the heart said "we read
// every one" while nothing was ever sent anywhere.
export function SuggestGameModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rules, setRules] = useState("");
  const [extra, setExtra] = useState("");
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  // Escape to close + lock the page scroll behind the modal.
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

  // Nothing is required — but sending a completely empty form has nothing to say, so at least one
  // field must have something in it before the button does anything.
  const hasAnything = Boolean((name + description + rules + extra).trim());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!hasAnything || sending) return;
    setSending(true);
    setError("");
    try {
      const r = await fetch("/api/game-idea", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, description, rules, extra }),
      });
      if (r.status === 429) {
        setError("That's a lot of ideas at once — give it a minute and send this one again.");
        return;
      }
      if (!r.ok) throw new Error(String(r.status));
      // Only thank them once it's actually landed — the thank-you is a promise that it was received.
      setSent(true);
    } catch {
      setError("Couldn't send it. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  const modal = (
    <div className={styles.overlay} onMouseDown={onClose} role="dialog" aria-modal="true" aria-label="Suggest a mini-game">
      <div className={styles.card} onMouseDown={(e) => e.stopPropagation()}>
        <div className={styles.head}>
          <span className={styles.spacer} />
          <span className={styles.title}>{sent ? "Thank you" : "Suggest a mini-game"}</span>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {sent ? (
          <div className={styles.thanks}>
            <span className={styles.heart} aria-hidden>
              <svg width="34" height="34" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 21s-6.7-4.35-9.33-8.06C.9 10.24 1.4 6.9 4.1 5.6c1.98-.95 4.05-.2 5.2 1.36L12 9.9l2.7-2.94c1.15-1.56 3.22-2.31 5.2-1.36 2.7 1.3 3.2 4.64 1.43 7.34C18.7 16.65 12 21 12 21Z" />
              </svg>
            </span>
            <p className={styles.thanksText}>Thanks for the idea — we read every one.</p>
            <button type="button" className={styles.done} onClick={onClose}>
              Done
            </button>
          </div>
        ) : (
          <form className={styles.form} onSubmit={submit}>
            <p className={styles.lead}>Tell us as much or as little as you like — any one field is enough.</p>

            <div className={styles.field}>
              <label htmlFor="sg-name">
                Name <span className={styles.opt}>(optional)</span>
              </label>
              <input id="sg-name" type="text" placeholder="What would you call it?" value={name} onChange={(e) => setName(e.target.value)} />
            </div>

            <div className={styles.field}>
              <label htmlFor="sg-desc">
                What is it? <span className={styles.opt}>(optional)</span>
              </label>
              <textarea id="sg-desc" rows={2} placeholder="The idea in a sentence or two" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>

            <div className={styles.field}>
              <label htmlFor="sg-rules">
                How does it work? <span className={styles.opt}>(optional)</span>
              </label>
              <textarea id="sg-rules" rows={2} placeholder="Rules — how viewers take part, how it resolves" value={rules} onChange={(e) => setRules(e.target.value)} />
            </div>

            <div className={styles.field}>
              <label htmlFor="sg-extra">
                Anything else <span className={styles.opt}>(required.. kidding, optional too)</span>
              </label>
              <textarea
                id="sg-extra"
                rows={3}
                placeholder="An example of it in action, why you think it'd work, where the idea came from…"
                value={extra}
                onChange={(e) => setExtra(e.target.value)}
              />
            </div>

            {error && <div className="error-note">{error}</div>}

            <button type="submit" className={styles.send} disabled={!hasAnything || sending}>
              {sending ? "Sending…" : "Send"}
            </button>
          </form>
        )}
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(modal, document.body);
}
