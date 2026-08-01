"use client";

// Heavy AppKit init — pulls in the full Reown/WalletConnect stack (~1.6MB). Imported ONLY by the
// lazily-loaded WalletConnectBridge (via next/dynamic), so this whole module lands in a separate async
// chunk fetched when the bridge mounts — never on the critical path of every page. The light
// enablement flag lives in ./appkit (no @reown imports) for the provider to read cheaply.
//
// Solana-only: no wagmi, no react-query. Wallets are auto-discovered via the Wallet Standard, so we
// pass NO `wallets:[]` array to the adapter.

import { createAppKit } from "@reown/appkit/react";
import { SolanaAdapter } from "@reown/appkit-adapter-solana";
import { solana, solanaDevnet, solanaTestnet } from "@reown/appkit/networks";
import type { AppKitNetwork } from "@reown/appkit/networks";
import { CHAIN_ID } from "./config";
import { REOWN_PROJECT_ID, isWalletConnectEnabled } from "./appkit";

// Match the network we transact on (config.CHAIN_ID) so the WalletConnect session opens on the same
// cluster as the injected path — otherwise a WC wallet could connect to mainnet while the app is on
// devnet. Default devnet; mainnet cutover follows CHAIN_ID with no code change here.
const defaultNetwork = CHAIN_ID === "solana-mainnet" ? solana : CHAIN_ID === "solana-testnet" ? solanaTestnet : solanaDevnet;

// createAppKit must run once, client-only. Guard on the projectId: with none we do NOT initialise
// (createAppKit requires a projectId and would throw). The returned modal is our imperative handle.
type AppKitModal = ReturnType<typeof createAppKit>;
let modal: AppKitModal | null = null;
// Set if createAppKit ever throws — WC is then treated as unavailable for the rest of the session.
let initFailed = false;

export function getModal(): AppKitModal | null {
  if (modal || typeof window === "undefined" || !isWalletConnectEnabled() || initFailed) return modal;
  try {
    modal = createAppKit({
      adapters: [new SolanaAdapter()],
      networks: [defaultNetwork, solana, solanaDevnet, solanaTestnet] as [AppKitNetwork, ...AppKitNetwork[]],
      defaultNetwork,
      projectId: REOWN_PROJECT_ID,
      metadata: {
        name: "Crown",
        description: "Donations straight to your wallet",
        url: window.location.origin,
        icons: [`${window.location.origin}/icon.svg`],
      },
      // Wallet connections only — no email/social sign-in, no analytics phone-home.
      features: { analytics: false, email: false, socials: false },
    });
  } catch {
    // A bad projectId or a relay/init failure must NOT take the page down. Mark WC unavailable so the
    // bridge treats it as down (its hooks would otherwise throw) and the modal shows "temporarily down".
    initFailed = true;
    modal = null;
  }
  return modal;
}

export function initFailedFlag(): boolean {
  return initFailed;
}

// Ensure AppKit is initialised (registers the modal web component). Idempotent; no-op on the server.
export function ensureAppKit(): void {
  getModal();
}
