"use client";

import { useState } from "react";
import { useGameChain } from "@/lib/chain/useGameChain";
import { settleScope } from "@/lib/chain/gameFlows";
import { useCollectionState } from "@/lib/chain/useScopeState";
import type { Contribution } from "@/lib/data/fundraiser";
import { usd } from "@/lib/money";
import { RefundButton } from "@/components/games/RefundButton";

// Settling a collection: one verdict, many escrows.
//
// This is where a collection differs from a task and where the difference bites.
// A task is one escrow, so "release the money" is one transaction. A collection
// is N — one per contribution — and every one of them has to be claimed with the
// SAME verdict signature. That signature is bought once (the flow serves it from
// the game's store afterwards, free), so the cost here is one paid pull no matter
// how many contributions there are; what scales is only the on-chain claims.
//
// Anyone may send them — `claim` is permissionless once the signature is public —
// so this sits in the creator's cabinet for convenience, not by right. The
// per-contribution result is kept visible: a partial settle (one claim failing on
// a stale blockhash, say) must be obvious, not silently reported as done.
export function SettleCollectionPanel({
  collection,
  contributions,
  recipient,
}: {
  collection: string | undefined;
  contributions: Contribution[];
  recipient: string;
}) {
  const chain = useGameChain("fundraiser");
  const { state, live } = useCollectionState(collection);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Record<string, "ok" | string>>({});

  const decided = state === "DecidedSettle" || state === "DecidedRefund";
  // Past their deadline, contributions refund with no verdict at all — so the
  // panel also has something to offer while the collection is still undecided.
  const stale = contributions.filter((c) => c.deadline && Date.now() / 1000 > c.deadline);
  if (!live || !collection || contributions.length === 0) return null;
  if (!decided && stale.length === 0) return null;

  const settle = async () => {
    if (!chain.wallet) return;
    setBusy(true);
    for (const c of contributions) {
      if (done[c.id] === "ok") continue;
      const res = await settleScope(chain.wallet, {
        game: "fundraiser",
        scope: collection,
        escrow: c.escrow,
        donor: c.donor,
        recipient,
      });
      setDone((prev) => ({ ...prev, [c.id]: res.ok ? "ok" : res.error }));
    }
    setBusy(false);
  };

  const settled = contributions.filter((c) => done[c.id] === "ok").length;
  const verdictWord = state === "DecidedSettle" ? "release" : "return";

  // Undecided but past the deadline: nothing to settle, everything to hand back.
  if (!decided) {
    return (
      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontWeight: 600 }}>No verdict, and the deadline has passed</div>
        <div className="footnote" style={{ marginTop: -4 }}>
          {stale.length} contribution{stale.length === 1 ? "" : "s"} can go back to whoever funded them — no signature
          needed, and anyone can send it.
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          {stale.map((c) => (
            <RefundButton
              key={c.id}
              wallet={chain.wallet}
              escrow={c.escrow}
              donor={c.donor}
              deadline={c.deadline!}
              label={`Return ${usd(c.amount)}`}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontWeight: 600 }}>
        {state === "DecidedSettle" ? "Confirmed — the money is yours" : "Not confirmed — everyone gets refunded"}
      </div>
      <div className="footnote" style={{ marginTop: -4 }}>
        {contributions.length} contribution{contributions.length === 1 ? "" : "s"} to {verdictWord}
        {settled > 0 ? ` · ${settled} done` : ""}. One signature covers them all.
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button type="button" className="btn" disabled={busy || !chain.wallet} onClick={() => void settle()}>
          {busy ? "Settling…" : settled ? "Finish the rest" : state === "DecidedSettle" ? "Release the money" : "Return the money"}
        </button>
      </div>
      {contributions.map((c) =>
        done[c.id] && done[c.id] !== "ok" ? (
          <div key={c.id} className="footnote" style={{ color: "var(--error)" }}>
            {usd(c.amount)} from {c.donor.slice(0, 4)}…{c.donor.slice(-4)}: {done[c.id]}
          </div>
        ) : null
      )}
    </div>
  );
}
