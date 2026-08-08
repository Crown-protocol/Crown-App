"use client";

import { useCheer } from "@/lib/data/DataProvider";
import { useSolanaWallet, type WalletName } from "./wallet";

// One wallet handle for both modes.
// mock — "connected" without a real wallet; chain — a real Phantom/Solflare wallet.
export function useWallet() {
  const { mode } = useCheer();
  const w = useSolanaWallet();

  if (mode === "mock") {
    return {
      mode,
      connected: true,
      address: undefined as string | undefined,
      connect: (_name?: WalletName) => {},
      disconnect: () => {},
      connecting: false,
      hasWallet: true,
      detected: [] as WalletName[],
      sendTransaction: w.sendTransaction,
    };
  }

  return {
    mode,
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
