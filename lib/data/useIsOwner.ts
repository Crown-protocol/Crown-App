"use client";

import { useSolanaWallet } from "@/lib/chain/wallet";
import { isOwnerAddress } from "./session";

// True only when the connected wallet is the platform owner's (OWNER_ADDRESS). Used to reveal the
// admin/ops entry in the UI — nobody else ever sees it. This is UX gating; the /admin route's real
// access check is server-side. Works in every data mode: it reads the live Solana wallet, which is
// null until a real wallet connects, so mock/demo visitors are never treated as the owner.
export function useIsOwner(): boolean {
  const { address } = useSolanaWallet();
  return isOwnerAddress(address);
}
