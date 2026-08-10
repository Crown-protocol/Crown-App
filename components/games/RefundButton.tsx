"use client";

import { useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { buildRefundTx } from "@/lib/chain/escrow";
import type { FlowWallet } from "@/lib/chain/gameFlows";

// The deadline's refund — the promise every escrow carries and the only one that
// needs nobody's cooperation.
//
// It exists because a resolver can go silent: a game that never reaches a verdict
// would otherwise hold the money forever. Past the deadline the factory lets
// ANYONE hand the escrow back to its donor, with no signature at all — so this
// button is offered to whoever is looking at the screen, creator or viewer, and
// it always pays the donor, never the clicker.
//
// It appears only after the deadline has passed. Before that the transaction is
// refused on chain (`NotYetRefundable`), and a button that exists to fail is
// worse than no button.
export function RefundButton({
  wallet,
  escrow,
  donor,
  deadline,
  label = "Refund it",
}: {
  wallet: FlowWallet | null;
  escrow: string;
  donor: string;
  deadline: number; // unix seconds
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const passed = Date.now() / 1000 > deadline;
  if (!passed || !wallet) return null;

  async function refund() {
    if (!wallet) return;
    setBusy(true);
    setNote("");
    try {
      const tx = buildRefundTx({
        caller: new PublicKey(wallet.address),
        escrow: new PublicKey(escrow),
        donor: new PublicKey(donor),
      });
      await wallet.sendTransaction(tx);
      setNote("Sent back.");
    } catch (e) {
      setNote(e instanceof Error ? e.message.split("\n")[0] : "That didn't go through.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn-outline" disabled={busy} onClick={() => void refund()}>
        {busy ? "Sending…" : label}
      </button>
      {note && <span className="footnote">{note}</span>}
    </>
  );
}
