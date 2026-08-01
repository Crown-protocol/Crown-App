"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSolanaWallet, type WalletName } from "@/lib/chain/wallet";
import { useProfile } from "@/lib/data/ProfileProvider";
import { useMyReputation } from "@/lib/data/useMyReputation";
import { clearProof } from "@/lib/data/proveOwnership";
import { PhantomIcon, SolflareIcon, WalletConnectIcon } from "@/components/WalletIcons";
import { WalletModal } from "@/components/WalletModal";
import styles from "./WalletConnect.module.css";

// The header's wallet control. Disconnected → opens the Connect Wallet modal (WalletModal). Connected
// → an account pill that drops a small menu (copy address, explorer, disconnect). Reuses the one
// SolanaWalletProvider, so state is shared with DonateForm and everywhere else.

const WALLET_ICON: Record<WalletName, (p: { size?: number }) => JSX.Element> = {
  phantom: PhantomIcon,
  solflare: SolflareIcon,
  walletconnect: WalletConnectIcon,
};
const WALLET_LABEL: Record<WalletName, string> = { phantom: "Phantom", solflare: "Solflare", walletconnect: "WalletConnect" };

function short(a: string) {
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

function WalletGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6H18" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <rect x="3.2" y="7.5" width="17.6" height="11.5" rx="2.6" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="16.4" cy="13.25" r="1.5" fill="currentColor" />
    </svg>
  );
}

export function WalletConnect() {
  const { address, connected, connecting, walletName, disconnect } = useSolanaWallet();
  const { signOut } = useProfile();
  const rep = useMyReputation();
  const [modalOpen, setModalOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  async function copyAddress() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  // ---- connected: account pill + menu ----
  if (connected && address) {
    const Icon = walletName ? WALLET_ICON[walletName] : null;
    return (
      <div className={styles.root} ref={rootRef}>
        <button type="button" className={styles.account} aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>
          <span className={styles.accountIcon}>{Icon ? <Icon size={22} /> : <span className={styles.liveDot} />}</span>
          <span className={`${styles.accountAddr} num`}>{short(address)}</span>
          <svg className={`${styles.chev}${menuOpen ? " " + styles.chevOpen : ""}`} width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {menuOpen && (
          <div className={`${styles.pop} ${styles.popRight}`} role="menu">
            <div className={styles.acctHead}>
              <span className={styles.acctHeadIcon}>{Icon ? <Icon size={34} /> : <WalletGlyph size={22} />}</span>
              <span className={styles.acctHeadText}>
                <span className={styles.acctHeadName}>
                  {walletName ? WALLET_LABEL[walletName] : "Wallet"} <span className={styles.liveDot} aria-hidden />
                </span>
                <span className={`${styles.acctHeadAddr} num`}>{short(address)}</span>
              </span>
            </div>

            {/* Where you stand, right in the account menu — the viewer's reputation has no other
                door in the header, and this is where people look for "my stuff". */}
            <Link className={styles.repRow} href="/me" onClick={() => setMenuOpen(false)}>
              <span className={styles.repFigure}>
                <span className={`${styles.repTotal} num`}>{rep.total}</span>
                <span className={styles.repUnit}>points</span>
              </span>
              <span className={styles.repText}>
                {rep.top ? (
                  <>
                    <span className={styles.repLead}>
                      {rep.bestTier ? rep.bestTier.name : "No tier yet"} with {rep.makers.length}{" "}
                      {rep.makers.length === 1 ? "maker" : "makers"}
                    </span>
                    <span className={styles.repSub}>
                      {rep.top.next ? `${rep.top.next.threshold - rep.top.rep} to ${rep.top.next.name} with ${rep.top.name}` : `Top tier with ${rep.top.name}`}
                    </span>
                  </>
                ) : (
                  <>
                    <span className={styles.repLead}>No reputation yet</span>
                    <span className={styles.repSub}>Every $1 you donate earns a point</span>
                  </>
                )}
              </span>
              <svg className={styles.repArrow} width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>

            <button type="button" className={styles.menuItem} onClick={copyAddress}>
              {copied ? <CheckGlyph /> : <CopyGlyph />}
              {copied ? "Copied" : "Copy address"}
            </button>
            <a
              className={styles.menuItem}
              href={`https://explorer.solana.com/address/${address}?cluster=devnet`}
              target="_blank"
              rel="noreferrer"
              onClick={() => setMenuOpen(false)}
            >
              <ExplorerGlyph />
              View on explorer
            </a>
            <button
              type="button"
              className={`${styles.menuItem} ${styles.menuDanger}`}
              onClick={() => {
                // Disconnect = sign out on this device: clear the ownership proof for this wallet
                // (capture the address before disconnect nulls it), drop the connection and the local
                // profile — so reconnecting asks the wallet to sign again. The DB copy is untouched.
                clearProof(address);
                void disconnect();
                signOut();
                setMenuOpen(false);
              }}
            >
              <PowerGlyph />
              Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }

  // ---- disconnected: the CTA opens the modal ----
  return (
    <div className={styles.root}>
      <button type="button" className={styles.connect} onClick={() => setModalOpen(true)}>
        <span className={styles.connectGlyph}>{connecting ? <span className={styles.spinner} aria-hidden /> : <WalletGlyph />}</span>
        <span className={styles.connectLabel}>{connecting ? "Opening…" : "Connect wallet"}</span>
      </button>
      {modalOpen && <WalletModal onClose={() => setModalOpen(false)} />}
    </div>
  );
}

// ---- tiny menu glyphs ----
function CopyGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="9" y="9" width="11" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M15 5.5A2 2 0 0 0 13 4H6a2 2 0 0 0-2 2v7a2 2 0 0 0 1.5 1.94" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
function CheckGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 12.5l4.5 4.5L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function ExplorerGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M14 4h6v6M20 4l-8.5 8.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
function PowerGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 4v7" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M7.5 7.5a7 7 0 1 0 9 0" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}
