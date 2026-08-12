// ──────────────────────────────────────────────────────────────────
// Copy to clipboard, or say so when it cannot.
//
// `navigator.clipboard` is not always there: it needs a secure context (so an
// http:// address on a phone in the same room does not have it), the permission
// can be refused, and some browsers only grant it inside a user gesture that a
// wrapped async call has already left. Every copy button in this app used to
// swallow that failure — `catch {}` — which turns a click into nothing at all,
// on exactly the controls a person clicks when they need the value most: a
// payout address, a page link, an overlay URL.
//
// So the fallback is a selection: the text ends up selected on screen and the
// caller is told to say "press ⌘C". That is worse than a copy and much better
// than silence.
// ──────────────────────────────────────────────────────────────────

/** What happened, in the two words the button has room to say. */
export type CopyResult = "copied" | "select";

/** The label a caller should show, so seven buttons cannot word this seven ways. */
export function copyLabel(r: CopyResult | null): string {
  return r === "copied" ? "Copied!" : r === "select" ? "Press ⌘C" : "";
}

export async function copyText(text: string): Promise<CopyResult> {
  if (!text) return "select";
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return "copied";
    }
  } catch {
    /* fall through to the selection */
  }
  try {
    // Off-screen but selectable: `display: none` cannot be selected, and a
    // visible one would make the page jump.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand?.("copy");
    // The selection stays put when the copy did not take, so ⌘C still works.
    if (ok) {
      ta.remove();
      return "copied";
    }
    setTimeout(() => ta.remove(), 10_000);
    return "select";
  } catch {
    return "select";
  }
}
