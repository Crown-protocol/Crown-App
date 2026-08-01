"use client";

import { useState } from "react";
import { DemoFrame } from "@/components/games/GameDemo";
import styles from "@/components/games/GameDemo.module.css";

// The task demo: Launch → a viewer composes a paid task (amount + deadline + text) → it sits in
// escrow and you either complete it (money's yours + the viewer earns reputation) or let it lapse
// (refunded). Mirrors TaskGameConfig — min $10, deadline up to 24h, you accept before the clock.
const AMOUNTS = [10, 25, 50];
const DEADLINES = ["6h", "12h", "24h"];
const fmt = (n: number) => "$" + n.toLocaleString("en-US");

export function TaskDemo() {
  const [step, setStep] = useState(0);
  const [text, setText] = useState("Beat the boss with no armor");
  const [amount, setAmount] = useState(25);
  const [deadline, setDeadline] = useState("24h");
  const [outcome, setOutcome] = useState<"open" | "done" | "lapsed">("open");

  function toRun() {
    setOutcome("open");
    setStep(2);
  }

  return (
    <DemoFrame step={step}>
      {step === 0 && (
        <div className={styles.screen}>
          <div className={styles.intro}>
            <span className={styles.orb} aria-hidden>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M5 12l4 4 10-10" /></svg>
            </span>
            <h3>Run a task through</h3>
            <p>A viewer sets a paid task. See what happens when you finish it — and when you don&apos;t.</p>
            <button className={styles.primary} type="button" style={{ marginTop: 8 }} onClick={() => setStep(1)}>
              Launch the demo
            </button>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className={styles.screen}>
          <div className={styles.stitle}>A viewer sets a task</div>
          <p className={styles.ssub}>What they want, how much they pay, and how long you get.</p>

          <div className={styles.field}>
            <label>The task</label>
            <div className={styles.addRow}>
              <input type="text" placeholder="What should you do?" maxLength={60} value={text} onChange={(e) => setText(e.target.value)} aria-label="Task text" />
            </div>
          </div>

          <div className={styles.field}>
            <label>Amount</label>
            <div className={styles.segrow}>
              {AMOUNTS.map((a) => (
                <button key={a} type="button" className={`${styles.seg} ${amount === a ? styles.on : ""}`} onClick={() => setAmount(a)}>
                  {fmt(a)}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.field}>
            <label>Deadline they picked</label>
            <div className={styles.segrow}>
              {DEADLINES.map((d) => (
                <button key={d} type="button" className={`${styles.seg} ${deadline === d ? styles.on : ""}`} onClick={() => setDeadline(d)}>
                  {d}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.sfoot}>
            <button className={styles.lnk} type="button" onClick={() => setStep(0)}>← Back</button>
            <button className={styles.primary} type="button" disabled={!text.trim()} onClick={toRun}>Accept the task →</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className={styles.screen}>
          <div className={styles.taskCard} style={outcome !== "open" ? { opacity: 0.55 } : undefined}>
            <div className={styles.taskTop}>
              <span className={styles.taskText}>“{text || "Do the thing"}”</span>
              <span className={styles.taskAmt}>{fmt(amount)}</span>
            </div>
            <div className={styles.taskMeta}>You accepted it — {deadline} on the clock · viewer: toffi</div>
            <div className={styles.taskBarTrack}>
              <div className={styles.taskBar} style={{ width: outcome === "open" ? "62%" : outcome === "done" ? "100%" : "62%" }} />
            </div>
            <span className={styles.escrowNote}><span className={styles.escrowDot} /> {fmt(amount)} held in escrow — nobody has it yet</span>
          </div>

          <div className={styles.result}>
            {outcome === "open" && "Finish it, or let the deadline pass."}
            {outcome === "done" && (<><span className={styles.good}>Done ✓</span> — {fmt(amount)} is yours, and toffi earns <b>+{amount} reputation</b>.</>)}
            {outcome === "lapsed" && (<><span className={styles.bad}>Deadline missed</span> — {fmt(amount)} is refunded to toffi, automatically.</>)}
          </div>

          {outcome === "open" ? (
            <div className={styles.rfoot}>
              <button className={styles.ghost} type="button" onClick={() => setOutcome("lapsed")}>Let it lapse</button>
              <button className={styles.primary} type="button" onClick={() => setOutcome("done")}>Complete it</button>
            </div>
          ) : (
            <div className={styles.rfoot}>
              <button className={styles.ghost} type="button" onClick={() => setStep(1)}>Edit</button>
              <button className={styles.primary} type="button" onClick={() => setOutcome("open")}>Run it again</button>
            </div>
          )}
          <p className={styles.railNote}>The verdict releases the money on-chain — to you, or back to them.</p>
        </div>
      )}
    </DemoFrame>
  );
}
