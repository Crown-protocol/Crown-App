"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useSolanaWallet, walletInstalled, isMobileBrowser, walletBrowseLink, type WalletName } from "@/lib/chain/wallet";
import { isWalletConnectEnabled } from "@/lib/chain/appkit";
import { PhantomIcon, SolflareIcon, WalletConnectIcon } from "@/components/WalletIcons";
import styles from "./WalletModal.module.css";

// The connect-wallet dialog — a centred modal (Aave-style): a featured primary (Phantom, the most
// popular Solana wallet), then the rest of the list. Rendered through a portal onto <body>, because
// the donation header uses backdrop-filter, which would otherwise trap a position:fixed overlay.
// `notice` lets the opener report a failure that happens AFTER connecting (account lookup down, the
// ownership signature declined). Showing it also clears the row's "Connecting…" spinner, which would
// otherwise sit there forever because the success path expects the modal to be torn down by navigation.
export function WalletModal({ onClose, onConnected, notice, step }: { onClose: () => void; onConnected?: () => void; notice?: string; step?: string }) {
  const { connect, detected } = useSolanaWallet();
  const [busy, setBusy] = useState<WalletName | null>(null);
  const [soon, setSoon] = useState(false);
  const [wcDown, setWcDown] = useState(false);
  const [err, setErr] = useState("");

  // A notice from the opener means the post-connect step failed: stop the spinner and surface it.
  useEffect(() => {
    if (!notice) return;
    setBusy(null);
    setErr(notice);
  }, [notice]);

  // WalletConnect broke on this attempt → tell the founders (throttled server-side) so they can fix
  // it, and show the viewer a calm "temporarily unavailable" note instead of a raw error. Never
  // throws — a failed report must not compound a failed connect.
  function reportWcDown(context: string) {
    setWcDown(true);
    void fetch("/api/wc-report", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ context }),
    }).catch(() => {});
  }

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

  async function choose(name: WalletName, installUrl: string) {
    // Check the LIVE window at click time, not the async probe — a wallet that injected a moment ago
    // must connect, not get sent to the install page (that was the "installed but redirects" bug).
    if (!walletInstalled(name)) {
      // No injected provider. On a phone that's expected (mobile wallets don't inject into a normal
      // browser) — open this page inside the wallet's own browser, where connecting works. On desktop
      // it means the extension really isn't there — send them to install it.
      window.open(isMobileBrowser() ? walletBrowseLink(name) : installUrl, "_blank", "noreferrer");
      return;
    }
    setBusy(name);
    setErr("");
    try {
      await connect(name);
      // Connected. If the opener wants to react (e.g. route to log-in vs register), hand off to it and
      // let IT close/replace the modal — otherwise just dismiss, the default header-button behaviour.
      if (onConnected) onConnected();
      else onClose();
    } catch (e) {
      setBusy(null);
      // Wallets reject with a PLAIN OBJECT ({ code: 4001, message: "User rejected" }), not an Error —
      // so pull the message/code out of both shapes. Otherwise String(obj) is "[object Object]",
      // which both misses the rejection filter AND shows garbage in the error banner.
      const obj = e as { code?: number; message?: string } | undefined;
      const msg = e instanceof Error ? e.message : typeof obj?.message === "string" ? obj.message : "";
      const rejected = obj?.code === 4001 || /reject|denied|declined|cancel|user closed|closed the popup/i.test(msg);
      // A user dismissing the wallet popup isn't an error — stay quiet. Anything else is shown, so a
      // silent failure ("nothing happens") becomes a message you can act on.
      if (!rejected) setErr(msg || "Couldn't connect. Try again.");
    }
  }

  // WalletConnect is a remote QR session, not an injected extension — so no install check. Opening
  // the AppKit modal returns as soon as the QR is shown; the actual connect happens asynchronously in
  // the bridge, which promotes the session to the active wallet. We close our own modal so AppKit's
  // QR is the only thing on screen (two stacked dialogs would fight).
  async function chooseWalletConnect() {
    if (!isWalletConnectEnabled()) {
      setSoon(true);
      return;
    }
    setErr("");
    setWcDown(false);
    try {
      await connect("walletconnect");
      // Hand off to the opener (or just dismiss) — the AppKit QR modal takes over from here.
      if (onConnected) onConnected();
      else onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      // A user dismissing the QR isn't a fault — stay quiet. Anything else means WalletConnect itself
      // couldn't come up (relay/init/session error): show "temporarily unavailable" and alert us.
      const cancelled = /reject|denied|declined|cancel|user closed|closed the modal/i.test(msg);
      if (!cancelled) reportWcDown(`connect: ${msg || "failed to open"}`.slice(0, 100));
    }
  }

  const modal = (
    <div className={styles.overlay} onMouseDown={onClose} role="dialog" aria-modal="true" aria-label="Connect wallet">
      <div className={styles.card} onMouseDown={(e) => e.stopPropagation()}>
        <div className={styles.head}>
          <Link className={styles.help} href="/wallet-guide" onClick={onClose} title="New to wallets? Here's how to set one up" aria-label="How to get a wallet">
            ?
          </Link>
          <span className={styles.title}>Connect Wallet</span>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* featured: Phantom */}
        <button
          type="button"
          className={styles.featured}
          disabled={busy === "phantom"}
          onClick={() => void choose("phantom", "https://phantom.app/download")}
        >
          {busy === "phantom" ? <span className={`${styles.spinner} ${styles.spinnerInk}`} aria-hidden /> : <PhantomIcon size={24} />}
          {busy === "phantom" ? "Connecting…" : "Continue with Phantom"}
          {/* No "Installed" chip on the featured button: the label is wide and centred, so a chip either
              collides with it or pushes it off-centre. Phantom is the highlighted default anyway — the
              badge is only meaningful on the secondary rows below, where it fits cleanly. */}
        </button>

        <div className={styles.divider}>or select a wallet from the list below</div>

        <div className={styles.list}>
          <button
            type="button"
            className={styles.row}
            disabled={busy === "solflare"}
            onClick={() => void choose("solflare", "https://solflare.com/download")}
          >
            <span className={styles.rowName}>{busy === "solflare" ? "Connecting…" : "Solflare"}</span>
            {busy !== "solflare" && detected.includes("solflare") && <span className={styles.installed}>Installed</span>}
            {busy === "solflare" ? <span className={styles.spinner} aria-hidden /> : <SolflareIcon size={30} />}
          </button>

          <button type="button" className={styles.row} onClick={() => void chooseWalletConnect()}>
            <span className={styles.rowName}>WalletConnect</span>
            <WalletConnectIcon size={30} />
          </button>
        </div>

        {soon && <div className={styles.soon}>WalletConnect isn&apos;t set up on this deployment yet — use Phantom or Solflare for now.</div>}
        {wcDown && (
          <div className={styles.soon}>
            WalletConnect is temporarily unavailable — we&apos;ve been notified and are on it. Use Phantom or Solflare in the meantime.
          </div>
        )}
        {!err && step && <div className={styles.soon}>{step}</div>}
        {err && <div className={styles.error}>{err}</div>}

        <div className={styles.foot}>
          By connecting your wallet you agree to the{" "}
          <Link href="/terms" onClick={onClose}>
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link href="/privacy" onClick={onClose}>
            Privacy Policy
          </Link>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(modal, document.body);
}
