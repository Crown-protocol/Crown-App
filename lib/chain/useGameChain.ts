"use client";

import { useSolanaWallet } from "./wallet";
import { gamePrincipals } from "./games";
import type { FlowWallet } from "./gameFlows";

// One question every game surface asks before touching the chain: is THIS game
// live — does its canister have a principal, and is the book reachable — and is
// there a wallet to sign with? Until the principals are set `live` is false
// everywhere and the surfaces run on their synced off-chain state; setting the
// env is the switch, with no code change behind it.
export function useGameChain(game: keyof typeof gamePrincipals): { live: boolean; wallet: FlowWallet | null } {
  const w = useSolanaWallet();
  const live = gamePrincipals[game]();
  const wallet: FlowWallet | null =
    w.connected && w.address ? { address: w.address, signMessage: w.signMessage, sendTransaction: w.sendTransaction } : null;
  return { live, wallet };
}
