"use client";

import { useEffect, useState } from "react";
import { useSolanaWallet } from "@/lib/chain/wallet";
import { useProfile } from "./ProfileProvider";
import { hasProof } from "./proveOwnership";

// Are you actually SIGNED IN right now? A profile must exist on this device, AND one of:
//   1. an editing SESSION on the server (the httpOnly cookie from your sign-in signature), OR
//   2. you've PROVEN ownership of the currently connected wallet on this device (hasProof).
//
// (1) is what makes a reload survivable. Without it this asked "is the wallet connected RIGHT NOW",
// and after F5 the page starts with no wallet attached — the extension reconnects a moment later, if
// at all — so the header rendered "Create or log in" over a session that was still valid for hours.
// Clicking it then logged you straight in with no signature, which is the tell: the server already
// knew who you were. The cookie is the credential; the wallet connection is not.
//
// Being merely CONNECTED is still NOT enough: mid-registration the wallet is connected but you
// haven't finished, so "Personal space" must not appear until the proof lands. Log out clears the
// proof AND deletes the session, so the header correctly falls back to signed-out.
export function useSignedIn(): boolean {
  const { address, connected } = useSolanaWallet();
  const { profile, hasSession } = useProfile();
  // hasProof reads localStorage, which changes without a React re-render — bump on the same events
  // that flip login state (proof written on register/login, cleared on log out) so this re-evaluates.
  const [proofTick, setProofTick] = useState(0);

  useEffect(() => {
    const sync = () => setProofTick((t) => t + 1);
    sync();
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  if (!profile) return false;
  void proofTick; // read so the proof check re-runs when it bumps
  // Connected wallet with its own proof, or — on a page that has just loaded, where the extension
  // hasn't reattached yet — any proof stored on this device. Requiring `connected` was the bug: for
  // the first seconds after F5 nothing is connected, so a signed-in visitor was shown the signed-out
  // landing. A proof is only written after a verified signature and log out deletes it.
  // Without a wallet attached, ask about the profile this device holds — not "any proof at all", which
  // on a shared browser showed a signed-in header for someone else's cached account.
  const proven = address ? connected && hasProof(address) : !!profile.address && hasProof(profile.address);
  return hasSession || proven;
}
