"use client";

import { useState } from "react";
import { DemoFrame } from "@/components/games/GameDemo";
import styles from "@/components/games/GameDemo.module.css";

// The fundraiser demo: Launch → set a promise + goal → watch chip-ins fill the bar; accept once it
// clears your floor, then deliver (pot's yours + backers earn reputation) or don't (all refunded).
// Mirrors FundraiserConfig — min chip-in $1, partial goal allowed from 50%.
const GOALS = [500, 1000, 2000];
const NAMES = ["toffi", "anna_k", "mira.eth", "demon_x", "sonya", "raidkeeper", "volk", "pixelira"];
const MIN_ACCEPT_PCT = 50; // DEFAULT_FUNDRAISER_CONFIG.minAcceptPct
const fmt = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

export function FundraiserDemo() {
  const [step, setStep] = useState(0);
  const [promise, setPromise] = useState("New stream setup");
  const [goal, setGoal] = useState(1000);
  const [contribs, setContribs] = useState<{ who: string; amt: number }[]>([]);
  const [phase, setPhase] = useState<"collecting" | "delivered" | "refunded">("collecting");

  const raised = contribs.reduce((s, c) => s + c.amt, 0);
  const pct = Math.min(100, Math.round((raised / goal) * 100));
  const canAccept = pct >= MIN_ACCEPT_PCT && phase === "collecting";

  function toRun() {
    setContribs([]);
    setPhase("collecting");
    setStep(2);
  }
  function chipIn() {
    const who = NAMES[Math.floor(contribs.length % NAMES.length)];
    const amt = Math.round(15 + Math.random() * (goal * 0.18));
    setContribs((c) => [{ who, amt }, ...c]);
  }

  return (
    <DemoFrame step={step}>
      {step === 0 && (
        <div className={styles.screen}>
          <div className={styles.intro}>
            <span className={styles.orb} aria-hidden>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 21s-7-4.5-9.2-9C1.3 9.2 2.7 6 5.8 6 8 6 9.2 7.6 12 10.5 14.8 7.6 16 6 18.2 6c3.1 0 4.5 3.2 3 6-2.2 4.5-9.2 9-9.2 9Z" /></svg>
            </span>
            <h3>Watch a goal fill up</h3>
            <p>Set a promise and a goal, take a few chip-ins, then deliver — or don&apos;t.</p>
            <button className={styles.primary} type="button" style={{ marginTop: 8 }} onClick={() => setStep(1)}>
              Launch the demo
            </button>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className={styles.screen}>
          <div className={styles.stitle}>Open your fundraiser</div>
          <p className={styles.ssub}>The promise, and how much you&apos;re collecting toward it.</p>

          <div className={styles.field}>
            <label>The promise</label>
            <div className={styles.addRow}>
              <input type="text" placeholder="What you'll do if it's funded" maxLength={40} value={promise} onChange={(e) => setPromise(e.target.value)} aria-label="Promise" />
            </div>
          </div>

          <div className={styles.field}>
            <label>Goal</label>
            <div className={styles.segrow}>
              {GOALS.map((g) => (
                <button key={g} type="button" className={`${styles.seg} ${goal === g ? styles.on : ""}`} onClick={() => setGoal(g)}>
                  {fmt(g)}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.sfoot}>
            <button className={styles.lnk} type="button" onClick={() => setStep(0)}>← Back</button>
            <button className={styles.primary} type="button" disabled={!promise.trim()} onClick={toRun}>Open it →</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className={styles.screen}>
          <div className={styles.goalTop}>
            <span className={styles.goalPromise}>{promise || "Your promise"}</span>
            <span className={styles.goalPct}>{pct}%</span>
          </div>
          <div className={styles.fillTrack}>
            <div className={styles.fillBar} style={{ width: `${pct}%` }} />
          </div>
          <div className={styles.goalNums}>
            <span>{fmt(raised)} raised</span>
            <span>of {fmt(goal)}</span>
          </div>

          <div className={styles.result}>
            {phase === "collecting" && (canAccept ? "Cleared your floor — you can accept it now." : `Chip in past ${MIN_ACCEPT_PCT}% to be able to accept.`)}
            {phase === "delivered" && (<><span className={styles.good}>Delivered ✓</span> — {fmt(raised)} is yours, every backer earns reputation.</>)}
            {phase === "refunded" && (<><span className={styles.bad}>Not delivered</span> — every backer is refunded to the cent, even past the goal.</>)}
          </div>

          {phase === "collecting" ? (
            <div className={styles.rfoot}>
              <button className={styles.ghost} type="button" onClick={chipIn}>Chip in</button>
              <button className={styles.primary} type="button" disabled={!canAccept} onClick={() => setPhase("delivered")}>Accept &amp; deliver</button>
            </div>
          ) : (
            <div className={styles.rfoot}>
              <button className={styles.ghost} type="button" onClick={() => setPhase("refunded")} disabled={phase === "refunded"}>Don&apos;t deliver</button>
              <button className={styles.primary} type="button" onClick={() => setStep(1)}>Start over</button>
            </div>
          )}

          {contribs.length > 0 && (
            <div className={styles.contribs}>
              {contribs.slice(0, 3).map((c, i) => (
                <div className={styles.contrib} key={contribs.length - i}>
                  <span className={styles.contribWho}>{c.who} chipped in</span>
                  <span className={styles.contribAmt}>{fmt(c.amt)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </DemoFrame>
  );
}
