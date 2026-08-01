"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSolanaWallet } from "@/lib/chain/wallet";
import { lookupAccountByOwner } from "@/lib/data/lookupAccount";
import { proveOwnership } from "@/lib/data/proveOwnership";
import { WalletModal } from "@/components/WalletModal";

// The single "Create or log in" entry. No middle page: the button opens the Connect-Wallet modal
// right here, and the moment a wallet is connected it decides where you go —
//   • the wallet already OWNS an account (found in the Crown DB) → hydrate it and open /space (log in)
//   • no account for this wallet                                 → /create (register; the wizard
//     picks up the connected wallet's address as the payout target)
// The account check is server-side (by wallet owner), so it works on a fresh device too, not only the
// browser you registered in.
export function AuthButton({ label = "Create or log in", className = "btn", style }: { label?: string; className?: string; style?: React.CSSProperties }) {
  const router = useRouter();
  const { address, connected, signMessage } = useSolanaWallet();
  const [open, setOpen] = useState(false);
  // "The user asked to sign in and we're now waiting for / acting on a connection." Gates the effect
  // below so it only routes as a result of THIS button, never a wallet connected elsewhere.
  const [routing, setRouting] = useState(false);
  // Where to send the user once the sign-in decision is made. Set by the async decision effect and
  // consumed by a SEPARATE navigation effect, so the router.push runs from a plain effect on a live
  // component (an async-tail push was getting dropped).
  const [dest, setDest] = useState<string | null>(null);
  // Post-connect failure to show inside the modal (lookup unreachable / signature declined).
  const [err, setErr] = useState("");
  // What the flow is doing right now, shown in the modal so the wallet's signature popup is never a
  // surprise ("why is my wallet asking me to sign something?").
  const [step, setStep] = useState("");
  // connect() resolves after setAddress(), but React may not have threaded the new address into this
  // render yet — the effect keyed on `address` is what guarantees we read the fresh one.
  const doneRef = useRef(false);

  // Decide the destination once a wallet is connected as a result of THIS button.
  useEffect(() => {
    if (!routing || doneRef.current) return;
    if (!connected || !address) return;
    doneRef.current = true; // decide exactly once per sign-in
    void (async () => {
      setStep("Checking your account…");
      const found = await lookupAccountByOwner(address);
      // Couldn't reach the account service. Do NOT fall through to /create: an existing creator sent
      // to registration can re-register their handle and overwrite their own live page. Say so and let
      // them retry.
      if (found.status === "error") {
        setStep("");
        setErr("Couldn't reach Crown to check your account. Check your connection and try again.");
        doneRef.current = false;
        setRouting(false);
        return;
      }
      if (found.status === "none") {
        setDest("/create"); // no account yet → registration (save() asks for its own signature)
        return;
      }
      // Existing account → log in. Prove ownership the FIRST time on this device (the wallet signs
      // once); a decline keeps you out rather than logging in unproven. We DON'T hydrate here — /space
      // hydrates itself from the same owner lookup on arrival (and the proof we just stored means it
      // won't re-prompt). Not touching the profile here keeps this button mounted so the redirect below
      // is guaranteed to fire.
      setStep("Confirm the signature in your wallet — it proves the wallet is yours. It's free and moves no funds.");
      const proof = await proveOwnership(address, signMessage);
      if (proof === "declined") {
        setStep("");
        // Dismissing the sign prompt must not leave the modal spinning on "Connecting…" forever.
        setErr("Sign the message in your wallet to prove it's yours, then try again.");
        doneRef.current = false;
        setRouting(false);
        return;
      }
      setDest("/space");
    })();
  }, [routing, connected, address, signMessage]);

  // Perform the navigation from a plain effect (not the async tail above), so it always runs on a live
  // component. Close the modal first, then navigate. We use a hard location change rather than
  // router.push: with the connect modal (a body portal) still tearing down, router.push was silently
  // not navigating — you stayed on the landing. A full navigation is reliable, and the destination
  // (/space) reads the freshly-stored profile/proof on arrival, so nothing is lost.
  useEffect(() => {
    if (!dest) return;
    setOpen(false);
    if (typeof window !== "undefined") window.location.assign(dest);
    else router.push(dest);
  }, [dest, router]);

  return (
    <>
      <button
        type="button"
        className={className}
        style={style}
        onClick={() => {
          doneRef.current = false;
          setDest(null);
          setErr("");
          setStep("");
          setRouting(false);
          setOpen(true);
        }}
      >
        {label}
      </button>
      {open && (
        <WalletModal
          notice={err}
          onClose={() => setOpen(false)}
          step={step}
          onConnected={() => {
            setErr("");
            // Keep the modal up (it shows the connecting state) and let the effect route once the
            // fresh address lands; arm the gate so only this flow reacts.
            setRouting(true);
          }}
        />
      )}
    </>
  );
}
