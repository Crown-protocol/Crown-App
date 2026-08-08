"use client";

import { useEffect, useRef, useState } from "react";
import { Mono } from "./Mono";
import styles from "./DemoDonation.module.css";
import { DEMO_NAME } from "@/lib/data/mock";

// A self-contained, obviously-fake demo of one donation, start to finish: pick an amount, press
// Donate, and watch it send → clear the contract's 3% → land in the streamer's wallet with the
// reputation it earns. Nothing here touches real state, a wallet, or the feed — it's a looping
// illustration for the "how it works" section, not the real DonateForm (which lives on the page).
const PRESETS = [5, 25, 100];
const FEE = 0.03;
type Phase = "idle" | "sending" | "done";

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function DemoDonation() {
  const [amount, setAmount] = useState(25);
  const [phase, setPhase] = useState<Phase>("idle");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Clear any pending timers on unmount so a state update never fires after teardown.
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  function run() {
    if (phase === "sending") return;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setPhase("sending");
    timers.current.push(setTimeout(() => setPhase("done"), 1400));
    timers.current.push(setTimeout(() => setPhase("idle"), 4200));
  }

  const net = amount * (1 - FEE);
  const rep = Math.round(amount);

  return (
    <div className={styles.card}>
      <div className={styles.chips} role="group" aria-label="Demo amount">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            className={`${styles.chip}${amount === p ? " " + styles.chipOn : ""}`}
            onClick={() => {
              setAmount(p);
              setPhase("idle");
              timers.current.forEach(clearTimeout);
            }}
            disabled={phase === "sending"}
          >
            ${p}
          </button>
        ))}
      </div>

      {/* the little journey: viewer → wallet, with a coin that travels across on send */}
      <div className={`${styles.track} ${styles[phase]}`}>
        <div className={styles.endpoint}>
          <span className={styles.avatar}>
            <svg viewBox="0 0 24 24" width={20} height={20} fill="none" aria-hidden>
              <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.7" />
              <path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </span>
          <span className={styles.endLabel}>You</span>
        </div>

        <div className={styles.wire}>
          <span className={styles.coin}>{money(amount).replace(".00", "")}</span>
        </div>

        <div className={`${styles.endpoint} ${styles.dest}`}>
          <Mono name={DEMO_NAME} size={40} />
          <span className={styles.endLabel}>{DEMO_NAME}</span>
        </div>
      </div>

      {/* the receipt updates as the phase advances */}
      <div className={styles.receipt}>
        <div className={styles.row}>
          <span>Donation</span>
          <b className="num">{money(amount)}</b>
        </div>
        <div className={styles.row}>
          <span>Smart contract · 3%</span>
          <b className="num">−{money(amount * FEE)}</b>
        </div>
        <div className={`${styles.row} ${styles.rowTotal}`}>
          <span>{phase === "done" ? `Landed in ${DEMO_NAME}'s wallet` : `${DEMO_NAME} receives`}</span>
          <b className="num">{money(net)}</b>
        </div>
      </div>

      <button type="button" className={styles.btn} onClick={run} disabled={phase === "sending"}>
        {phase === "sending" ? "Sending…" : phase === "done" ? `Done · ${DEMO_NAME} earned +${rep} reputation` : `Cheer ${money(amount).replace(".00", "")}`}
      </button>

      <div className={styles.foot}>Demo — no wallet needed. One on-chain transaction, funds land instantly.</div>
    </div>
  );
}
