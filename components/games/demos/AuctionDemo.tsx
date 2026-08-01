"use client";

import { useState } from "react";
import { DemoFrame } from "@/components/games/GameDemo";
import styles from "@/components/games/GameDemo.module.css";

// The auction demo: Launch → accept a few lots (a condition + a bid) → viewers top them up; the
// richest lot leads. Ring the bell and the top lot wins, every other lot is refunded on the spot.
// Mirrors AuctionConfig — min bid $5, outbid step $1.
const STEP = 1; // DEFAULT_AUCTION_CONFIG.minIncrement
const START: { name: string; amt: number }[] = [
  { name: "Hardest difficulty", amt: 120 },
  { name: "Cam upside down", amt: 85 },
  { name: "No-hit run", amt: 40 },
];
const fmt = (n: number) => "$" + n.toLocaleString("en-US");

export function AuctionDemo() {
  const [step, setStep] = useState(0);
  const [lots, setLots] = useState(START.map((l) => ({ ...l })));
  const [name, setName] = useState("");
  const [amt, setAmt] = useState("");
  const [closed, setClosed] = useState(false);

  const sorted = [...lots].sort((a, b) => b.amt - a.amt);
  const leadAmt = sorted[0]?.amt ?? 0;

  function addLot() {
    const n = name.trim();
    if (!n) return;
    const a = Math.max(5, Math.round(Number(amt)) || 30);
    setLots((l) => [...l, { name: n, amt: a }]);
    setName("");
    setAmt("");
  }

  function outbid() {
    // a viewer tops up a non-leading lot past the leader by the outbid step — it climbs the board
    setLots((cur) => {
      if (cur.length < 2) return cur;
      const s = [...cur].sort((a, b) => b.amt - a.amt);
      const lead = s[0].amt;
      const challenger = s[1];
      const bump = lead - challenger.amt + STEP + Math.round(Math.random() * 40);
      return cur.map((l) => (l === challenger ? { ...l, amt: l.amt + bump } : l));
    });
  }

  function toRun() {
    if (lots.length < 2) return;
    setClosed(false);
    setStep(2);
  }

  return (
    <DemoFrame step={step}>
      {step === 0 && (
        <div className={styles.screen}>
          <div className={styles.intro}>
            <span className={styles.orb} aria-hidden>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M14 6 6 14M9 4l7 7M4 20h7M13 9l4-4M17 13l3-3" /></svg>
            </span>
            <h3>Run a bidding round</h3>
            <p>Take a few lots, watch them climb, then ring the bell — top lot wins, the rest refund.</p>
            <button className={styles.primary} type="button" style={{ marginTop: 8 }} onClick={() => setStep(1)}>
              Launch the demo
            </button>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className={styles.screen}>
          <div className={styles.stitle}>Accept the lots</div>
          <p className={styles.ssub}>Each is a condition a viewer will pay for. Add or remove some.</p>
          <div className={styles.rows}>
            {lots.map((l, i) => (
              <div className={styles.row} key={i}>
                <span className={styles.rowName}>{l.name}</span>
                <span className={styles.rowAmt}>{fmt(l.amt)}</span>
                <button className={styles.rm} type="button" aria-label="Remove" onClick={() => setLots((x) => x.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
          </div>
          <div className={styles.addRow}>
            <input type="text" placeholder="Add a lot" maxLength={22} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addLot()} aria-label="Lot" />
            <input className={styles.amt} type="number" min={5} placeholder="$" value={amt} onChange={(e) => setAmt(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addLot()} aria-label="Bid" />
            <button className={styles.add} type="button" aria-label="Add lot" onClick={addLot}>+</button>
          </div>
          <div className={styles.sfoot}>
            <button className={styles.lnk} type="button" onClick={() => setStep(0)}>← Back</button>
            <button className={styles.primary} type="button" onClick={toRun}>Open the bidding →</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className={styles.screen}>
          <div className={styles.board}>
            {sorted.map((l, i) => {
              const isLead = i === 0;
              const won = closed && isLead;
              const refunded = closed && !isLead;
              return (
                <div key={l.name + i} className={`${styles.lot} ${isLead && !closed ? styles.lead : ""} ${refunded ? styles.out : ""}`}>
                  {isLead && !closed && <span className={styles.lotFill} style={{ width: `${Math.round((l.amt / (leadAmt || 1)) * 100)}%` }} />}
                  <span className={styles.lotName}>
                    {l.name}
                    {won && <span className={styles.lotTag}>Winner</span>}
                    {isLead && !closed && <span className={styles.lotTag}>Leading</span>}
                    {refunded && <span className={styles.lotTag} style={{ color: "var(--text-3)" }}>Refunded</span>}
                  </span>
                  <span className={styles.lotAmt}>{fmt(l.amt)}</span>
                </div>
              );
            })}
          </div>

          <div className={styles.result}>
            {!closed && <>Highest accepted lot leads at <b>{fmt(leadAmt)}</b> — anyone can still outbid.</>}
            {closed && (<><span className={styles.win}>{sorted[0]?.name}</span> wins at <b>{fmt(leadAmt)}</b> — you do it; every other lot is refunded.</>)}
          </div>

          {!closed ? (
            <div className={styles.rfoot}>
              <button className={styles.ghost} type="button" onClick={outbid} disabled={lots.length < 2}>Outbid</button>
              <button className={styles.primary} type="button" onClick={() => setClosed(true)}>Ring the bell</button>
            </div>
          ) : (
            <div className={styles.rfoot}>
              <button className={styles.ghost} type="button" onClick={() => setStep(1)}>Edit</button>
              <button className={styles.primary} type="button" onClick={() => setClosed(false)}>Run it again</button>
            </div>
          )}
          <p className={styles.railNote}>Losing lots are refunded instantly; the winner pays on delivery.</p>
        </div>
      )}
    </DemoFrame>
  );
}
