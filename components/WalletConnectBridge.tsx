"use client";

import { useEffect } from "react";
import { useAppKit, useAppKitAccount, useAppKitProvider, useDisconnect } from "@reown/appkit/react";
import { useAppKitConnection, type Provider as SolanaWcProvider } from "@reown/appkit-adapter-solana/react";
import { ensureAppKit } from "@/lib/chain/appkit-init";
import type { WcBridgeState } from "@/lib/chain/wallet";

// Bridges AppKit's WalletConnect session into SolanaWalletProvider. It lives in its OWN file, loaded
// lazily via next/dynamic (ssr:false) from the provider — so the heavy AppKit/WalletConnect bundle
// (~1.6MB) is a separate async chunk that only downloads when this mounts, NOT on the critical path of
// every page. That's what kept the page fast: statically importing AppKit into the top-level provider
// put its whole stack in front of hydration, stalling the UI (e.g. the register button) after connect.
//
// Rendered only when WalletConnect is configured (a Reown project id is present) — AppKit's hooks
// require createAppKit to have run. It renders nothing; it just wires AppKit's reactive state up.
export default function WalletConnectBridge({
  onState,
  registerOpen,
}: {
  onState: (s: WcBridgeState) => void;
  registerOpen: (fn: () => Promise<void>) => void;
}) {
  // Initialise AppKit BEFORE the hooks below run. AppKit's hooks (useAppKit/…) fire during render and
  // require createAppKit to have already executed — doing this in a useEffect ran it a render too late
  // ("call createAppKit before using useAppKit"). getModal() is idempotent, so calling it inline each
  // render is cheap and guarantees the store exists before the first hook call.
  ensureAppKit();

  const { open } = useAppKit();
  const { address, isConnected, status } = useAppKitAccount();
  const { walletProvider } = useAppKitProvider<SolanaWcProvider>("solana");
  const { disconnect } = useDisconnect();
  // Not used for signing, but subscribing keeps the adapter's connection warm/consistent.
  useAppKitConnection();

  // Expose the modal opener to the provider so connect("walletconnect") can trigger the QR.
  useEffect(() => {
    registerOpen(async () => {
      await open({ view: "Connect", namespace: "solana" });
    });
  }, [open, registerOpen]);

  // Push every AppKit account change up to the provider.
  useEffect(() => {
    onState({
      address: isConnected && address ? address : null,
      connecting: status === "connecting" || status === "reconnecting",
      provider: walletProvider ?? null,
      disconnect: async () => {
        await disconnect({ namespace: "solana" });
      },
    });
  }, [address, isConnected, status, walletProvider, disconnect, onState]);

  return null;
}
