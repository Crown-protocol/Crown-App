"use client";

import { useEffect, useState } from "react";
import { useGameSync } from "@/lib/data/gameSync";
import { useGameChain } from "@/lib/chain/useGameChain";
import { fundingAction } from "@/lib/chain/gameFlows";
import { Mono } from "@/components/Mono";
import { StatTile } from "@/components/ops";
import { usd } from "@/lib/money";
import { fundraiserRules } from "@/lib/data/gameConfig";
import {
  withFundraiserDefaults,
  readBackers,
  raisedTotal,
  readStatus,
  writeStatus,
  type Backer,
  type FundraiserStatus,
} from "@/lib/data/fundraiser";
import type { Profile } from "@/lib/data/types";
import { useConfirm } from "@/components/useConfirm";
import { dangerCopy } from "@/lib/data/dangerous";
import styles from "./GameOverview.module.css";

// The streamer's live view of the running fundraiser — the accept/deliver decisions the settings
// only describe. Chip-ins land in escrow (raised = seeded backers + real test chip-ins); accept
// the amount to start the delivery clock, then deliver — or refund everyone. State sticks in the
// shared mock store (lib/data/fundraiser.ts).
export function FundraiserOverview({ profile, scope }: { profile: Profile; scope?: string }) {
  const handle = scope ?? profile.handle;
  // Accepting, delivering and refunding all decide what happens to other people's money.
  const confirm = useConfirm();
  const fr = withFundraiserDefaults(profile); // the page copy (the promise); the numbers come from cfg
  // This collection's rules — including its own goal, which every run sets for itself.
  const cfg = fundraiserRules(profile, handle);

  const [raised, setRaised] = useState(0);
  const [backers, setBackers] = useState<Backer[]>([]);
  const [status, setStatus] = useState<FundraiserStatus>({ state: "collecting" });

  // Shared game state: viewers' chip-ins from other browsers land via the nonce dep.
  const syncNonce = useGameSync(handle);
  useEffect(() => {
    setRaised(raisedTotal(handle));
    setBackers(readBackers(handle));
    setStatus(readStatus(handle));
  }, [handle, syncNonce]);

  const goal = cfg.goal;
  const pct = Math.min(100, Math.round((raised / goal) * 100));
  // Where "Accept" unlocks: the min % of goal (or the full goal when partials are off).
  const acceptThreshold = cfg.allowBelowGoal ? Math.ceil((goal * cfg.minAcceptPct) / 100) : goal;
  const markPct = cfg.allowBelowGoal ? Math.min(100, cfg.minAcceptPct) : 100;
  const canAccept = raised >= acceptThreshold;

  const chain = useGameChain("fundraiser");

  function set(next: FundraiserStatus) {
    // Merge, don't replace — the chain collection id must survive every state hop.
    const merged: FundraiserStatus = { ...status, ...next };
    // On-chain twin: "delivered" = ready (the vote decides the payout), "refunded" = the
    // recipient's own cancel. The canister is the enforcement; this UI is the intent.
    if (status.chainCollection && chain.live && chain.wallet) {
      if (next.state === "delivered") void fundingAction(chain.wallet, status.chainCollection, "ready");
      if (next.state === "refunded") void fundingAction(chain.wallet, status.chainCollection, "recipient_cancel");
    }
    setStatus(writeStatus(handle, merged));
  }

  return (
    <div className={styles.col}>
      <div className="footnote">
        Chip-ins land in escrow. Accept the amount when you&apos;re ready, then deliver within your window — or
        everyone&apos;s refunded.
      </div>

      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div className={styles.promise}>{fr.pledge || "Set your promise on the Page tab."}</div>
        <div className={styles.progress}>
          <div className={styles.bar}>
            <div className={styles.barFill} style={{ width: `${pct}%` }} />
            {markPct < 100 && (
              <div className={styles.barMark} style={{ left: `${markPct}%` }} title={`Accept unlocks at ${cfg.minAcceptPct}% of goal`} />
            )}
          </div>
          <div className={styles.progressMeta}>
            <span>
              <b className="num">{usd(raised)}</b> of {usd(goal)}
            </span>
            <span>
              {pct}% · {backers.length} backers
            </span>
          </div>
        </div>
      </div>

      <div className="stat-grid">
        <StatTile k="Raised" v={usd(raised)} />
        <StatTile k="Goal" v={usd(goal)} />
        <StatTile k="Backers" v={String(backers.length)} />
      </div>

      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {status.state === "collecting" && (
          <>
            <div className={styles.statusRow}>
              <button
                type="button"
                className="btn"
                disabled={!canAccept}
                onClick={() => confirm(dangerCopy.acceptRaise(raised), () => set({ state: "delivering", accepted: raised }))}
              >
                Accept {usd(raised)}
              </button>
            </div>
            <div className="footnote">
              {canAccept
                ? `Collection runs ${cfg.fundingDays} days. Accepting starts your ${cfg.deliveryDays}-day delivery window.`
                : `Accept unlocks at ${usd(acceptThreshold)} — ${cfg.allowBelowGoal ? `${cfg.minAcceptPct}% of the goal` : "the full goal"}.`}
            </div>
          </>
        )}

        {status.state === "delivering" && (
          <>
            <span className="pill attn" style={{ alignSelf: "flex-start" }}>
              <span className="dot" />
              Delivering — accepted {usd(status.accepted)}
            </span>
            <div className={styles.statusRow}>
              <button
                type="button"
                className="btn"
                onClick={() => confirm(dangerCopy.markDelivered(status.accepted ?? raised), () => set({ state: "delivered" }))}
              >
                Mark delivered
              </button>
              <button
                type="button"
                className="btn-outline"
                onClick={() => confirm(dangerCopy.refundRaise(status.accepted ?? raised), () => set({ state: "refunded" }), { danger: true })}
              >
                Refund everyone
              </button>
            </div>
            <div className="footnote">Deliver within {cfg.deliveryDays} days of accepting — your reputation holders confirm it.</div>
          </>
        )}

        {status.state === "delivered" && (
          <>
            <span className="pill ok" style={{ alignSelf: "flex-start" }}>
              <span className="dot" />
              Delivered — the payout is yours
            </span>
            <div className="footnote">Every backer earned reputation for exactly what they put in.</div>
            <button type="button" className="btn-outline" style={{ alignSelf: "flex-start" }} onClick={() => set({ state: "collecting" })}>
              Reset demo
            </button>
          </>
        )}

        {status.state === "refunded" && (
          <>
            <span className="pill wait" style={{ alignSelf: "flex-start" }}>
              <span className="dot" />
              Refunded to backers
            </span>
            <div className="footnote">Nobody earned reputation — the promise wasn&apos;t delivered.</div>
            <button type="button" className="btn-outline" style={{ alignSelf: "flex-start" }} onClick={() => set({ state: "collecting" })}>
              Reset demo
            </button>
          </>
        )}
      </div>

      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div className={styles.head}>Backers</div>
        <div className={styles.backers}>
          {backers.map((b, i) => (
            <div key={i} className={styles.backer}>
              <Mono name={b.name} size={36} />
              <span className={styles.backerName}>{b.name}</span>
              <span className={styles.when}>{b.when}</span>
              <span className={styles.backerAmt}>
                {usd(b.amount)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="notice">
        <b>Fixed by the contract, not a setting here:</b> deliver and the pot is yours; miss it — even with the goal met
        — and every backer is refunded exactly what they put in.
      </div>
      {confirm.dialog}
    </div>
  );
}
