"use client";

// WalletConnect enablement flag — deliberately LIGHT (no @reown imports). This module is imported by
// SolanaWalletProvider on the critical path of every page, so it must not pull in the ~1.6MB AppKit
// stack. The heavy init (createAppKit / getModal) lives in ./appkit-init, imported ONLY by the lazily
// loaded WalletConnectBridge — so AppKit downloads as a separate async chunk when the bridge mounts,
// never blocking hydration.

// Public project id from the Reown dashboard (https://cloud.reown.com). WITHOUT it, WalletConnect is
// simply unavailable (the modal row explains how to enable it) — Phantom/Solflare are unaffected.
export const REOWN_PROJECT_ID = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID || "";

export function isWalletConnectEnabled(): boolean {
  return REOWN_PROJECT_ID.length > 0;
}
