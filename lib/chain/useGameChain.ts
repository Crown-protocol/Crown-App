"use client";

import { useCheer } from "@/lib/data/DataProvider";
import { useSolanaWallet } from "./wallet";
import { gamePrincipals } from "./games";
import type { FlowWallet } from "./gameFlows";

// One question every game surface asks before touching the chain: is THIS game live
// (chain mode + its canister has a principal), and is there a wallet to sign with?
// While canisters aren't deployed (principals empty) `live` is false everywhere and
// every UI stays on its mock/synced path — flipping the env is the launch switch.
export function useGameChain(game: keyof typeof gamePrincipals): { live: boolean; wallet: FlowWallet | null } {
  const { mode } = useCheer();
  const w = useSolanaWallet();
  const live = mode === "chain" && gamePrincipals[game]();
  const wallet: FlowWallet | null =
    w.connected && w.address ? { address: w.address, signMessage: w.signMessage, sendTransaction: w.sendTransaction } : null;
  return { live, wallet };
}
