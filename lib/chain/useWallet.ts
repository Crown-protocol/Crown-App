"use client";

import { useSolanaWallet, type WalletName } from "./wallet";

// The wallet, as the donation surfaces need it. There is one kind now: a real
// Phantom/Solflare wallet. The "connected without a wallet" branch that used to
// live here belonged to the mock mode — money always moves for real, so a
// pretend connection has nothing left to pretend about.
export function useWallet() {
  const w = useSolanaWallet();

  return {
    connected: w.connected,
    address: w.address ?? undefined,
    // Default to Phantom, else whatever is installed — the picker in
    // WalletButton passes an explicit name.
    connect: (name?: WalletName) => {
      const target = name ?? (w.detected.includes("phantom") ? "phantom" : w.detected[0]);
      if (target) void w.connect(target).catch(() => {});
    },
    disconnect: () => void w.disconnect(),
    connecting: w.connecting,
    hasWallet: w.detected.length > 0,
    detected: w.detected,
    sendTransaction: w.sendTransaction,
  };
}
