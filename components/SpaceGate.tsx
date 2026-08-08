"use client";

import { Logo } from "@/components/Logo";
import { WalletConnect } from "@/components/WalletConnect";
import { CheerBadge } from "@/components/CheerBadge";
import { isDemoAddress } from "@/lib/data/session";
import styles from "./SpaceGate.module.css";

const short = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

/**
 * The sign-in wall for the personal space. The wallet is the login: you get in if you hold the
 * wallet the page's payouts go to.
 *
 * The demo way in exists because it has to: a page created in demo mode is paid out to a
 * placeholder address nobody holds the key to, so requiring a matching wallet would lock its
 * owner out forever. It's spelled out rather than hidden — this build has no accounts.
 */
export function SpaceGate({
  pageAddress,
  connectedAddress,
  allowDemo,
  onDemoEnter,
  onRetry,
}: {
  pageAddress: string;
  connectedAddress?: string;
  allowDemo: boolean;
  onDemoEnter: () => void;
  // Re-opens the ownership signature request. The right wallet is connected but the popup was
  // dismissed (or returned no session) — without this the person is stranded on "Confirm the
  // signature" with nothing to click. Optional: the cold-open gate has no signature to retry.
  onRetry?: () => void;
}) {
  // Three distinct states, and they must not be confused:
  //   • a DIFFERENT wallet is connected      → "that's not this page's wallet" (switch accounts)
  //   • THIS page's wallet is connected but
  //     hasn't signed the ownership proof yet → "confirm the signature" (the popup is open right now)
  //   • nothing connected                     → "connect your wallet"
  // Comparing addresses is what was missing: `Boolean(connectedAddress)` called every connected wallet
  // "wrong", so re-signing after a re-registration showed "you're connected as X but this page pays out
  // to X — switch to that wallet", naming the same address twice.
  const sameWallet = Boolean(connectedAddress) && Boolean(pageAddress) && connectedAddress === pageAddress;
  const wrongWallet = Boolean(connectedAddress) && !sameWallet;
  const awaitingSignature = sameWallet;
  const demoPage = isDemoAddress(pageAddress);

  return (
    <main className="page">
      <header className="appbar">
        <Logo />
      </header>

      <div className={styles.wrap}>
        <div className={styles.card}>
          <CheerBadge className={styles.mark} />

          {awaitingSignature ? (
            <>
              <h1 className={styles.title}>Confirm the signature</h1>
              <p className={styles.lead}>
                Your wallet <span className={`${styles.addr} num`}>{short(connectedAddress!)}</span> is connected —
                approve the signature request to finish signing in. It&apos;s free and moves no funds. Closed it by
                mistake? Ask for it again.
              </p>
              {onRetry && (
                <button type="button" className={styles.retry} onClick={onRetry}>
                  Sign again
                </button>
              )}
            </>
          ) : wrongWallet ? (
            <>
              <h1 className={styles.title}>That&apos;s not this page&apos;s wallet</h1>
              <p className={styles.lead}>
                You&apos;re connected as <span className={`${styles.addr} num`}>{short(connectedAddress!)}</span>, but this
                page pays out to <span className={`${styles.addr} num`}>{short(pageAddress)}</span>. Switch to that wallet
                to get in.
              </p>
            </>
          ) : (
            <>
              <h1 className={styles.title}>Connect your wallet</h1>
              <p className={styles.lead}>
                Your wallet is your login — Cheer has no passwords. You&apos;re the owner of this page if you hold the
                wallet it pays out to
                {!demoPage && (
                  <>
                    : <span className={`${styles.addr} num`}>{short(pageAddress)}</span>
                  </>
                )}
                .
              </p>
            </>
          )}

          <div className={styles.action}>
            <WalletConnect />
          </div>

          {allowDemo && (
            <div className={styles.demo}>
              <span className={styles.demoNote}>
                {demoPage
                  ? "This page was created in demo mode — its payout address is a placeholder, so no wallet can own it yet."
                  : "The app is running on mock data — nothing here is real money yet."}
              </span>
              <button type="button" className={styles.demoBtn} onClick={onDemoEnter}>
                Continue in demo mode
              </button>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
