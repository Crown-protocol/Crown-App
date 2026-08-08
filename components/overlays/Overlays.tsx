"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Mono } from "@/components/Mono";
import { CheerMark, GameIcon } from "@/components/icons";
import { RouletteWheel } from "@/components/RouletteWheel";
import { FundraiserFill } from "@/components/FundraiserFill";
import { useCountUp, useChangeNonce, useFlip } from "./fx";
import { useDonationStream } from "@/lib/data/useDonationStream";
import { DEMO_GOAL, DEMO_GOAL_START, DEMO_FUNDRAISER_GOAL, OVERLAY_TIERS } from "@/lib/data/overlays";
import { readRound, readRoundMeta } from "@/lib/data/roulette";
import { MOCK_ROUND, pickWeighted, type RouletteSuggestion } from "@/lib/data/roulette-mock";
import { readTasks, type GameTask } from "@/lib/data/tasks";
import { raisedTotal, withFundraiserDefaults } from "@/lib/data/fundraiser";
import { usePublicProfile } from "@/lib/data/usePublicProfile";
import { readLots, readAuctionMeta, leaderboard, lotSum, type AuctionLot } from "@/lib/data/auction";
import { firstActiveScope } from "@/lib/data/gameSessions";
import type { DonationEvent } from "@/lib/data/donationStream";
import styles from "./Overlays.module.css";

interface Common {
  handle: string;
  demo?: boolean;
}

// Donor names for the widgets whose demo loops fabricate chip-ins in STATE (fundraiser & co poll
// their stores, so startDemo's BroadcastChannel events never reach them).
const DEMO_DONORS = ["Timur", "anna_k", "lesya", "Whale", "Dan"];
function pickName(): string {
  return DEMO_DONORS[Math.floor(Math.random() * DEMO_DONORS.length)];
}

// ---- Alerts: one popup per donation, amount-tiered, queued so bursts don't overlap. ----

// Tier by amount: 0 = small (<$25), 1 = mid ($25–99, gradient strip), 2 = big ($100+, grown card).
function alertTier(amount: number): 0 | 1 | 2 {
  return amount >= 100 ? 2 : amount >= 25 ? 1 : 0;
}
const TIER_HOLD = [5000, 5000, 8000];
const ALERT_QUEUE_CAP = 40; // a raid can stack for minutes, not forever — overlays run for hours

export function AlertsOverlay({ handle, demo, min }: Common & { min?: number }) {
  const [queue, setQueue] = useState<DonationEvent[]>([]);
  // hold is computed ONCE at dequeue and drives both the JS dismiss timer and (via the --hold
  // custom property) the CSS exit delay — the two can never drift apart.
  const [current, setCurrent] = useState<{ e: DonationEvent; hold: number } | null>(null);

  useDonationStream(
    handle,
    (e) => {
      // ?min= hides small donations so a burst of $1s doesn't bury a big one on stream.
      if (min !== undefined && e.amount < min) return;
      setQueue((q) => (q.length >= ALERT_QUEUE_CAP ? q : [...q, e]));
    },
    demo,
  );

  // Dequeue the next alert when nothing is showing. No timer here — this effect re-runs whenever it
  // sets `current`, and a timer set here would be cleared on that same re-run (the freeze bug).
  useEffect(() => {
    if (current || queue.length === 0) return;
    const e = queue[0];
    const waiting = queue.length - 1; // what stays queued behind this one
    const readable = Math.min(8000, 5000 + 40 * (e.message?.length ?? 0));
    // Burst compression: >3 still waiting → 3.5s each, so a raid never lags minutes behind chat.
    const hold = waiting > 3 ? 3500 : Math.max(TIER_HOLD[alertTier(e.amount)], readable);
    setCurrent({ e, hold });
    setQueue((q) => q.slice(1));
  }, [queue, current]);

  // Dismiss after the computed hold. Keyed on `current` alone, so the timer lives its full life.
  useEffect(() => {
    if (!current) return;
    const t = setTimeout(() => setCurrent(null), current.hold);
    return () => clearTimeout(t);
  }, [current]);

  const tier = current ? alertTier(current.e.amount) : 0;
  return (
    <div className={`${styles.stage} ${styles.stageTop}`}>
      {current && (
        <div
          key={current.e.ts}
          className={`${styles.alert} ${tier === 1 ? styles.alertT1 : ""} ${tier === 2 ? styles.alertT2 : ""}`}
          style={{ "--hold": `${current.hold}ms` } as CSSProperties}
        >
          {queue.length > 0 && <span className={`${styles.alertQueue} num`}>+{queue.length}</span>}
          <Mono name={current.e.from} size={tier === 2 ? 64 : 46} />
          <div className={styles.alertBody}>
            <div className={styles.alertLine}>
              <b>{current.e.from}</b> donated <AlertAmount amount={current.e.amount} />
            </div>
            {current.e.message && <div className={styles.alertMsg}>{current.e.message}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// Counts 0→amount over 600ms (the card remounts per event, so mount at 0 and retarget), then pops
// once the count lands — the CSS pop is delayed by the same 600ms.
function AlertAmount({ amount }: { amount: number }) {
  const [target, setTarget] = useState(0);
  useEffect(() => setTarget(amount), [amount]);
  const v = useCountUp(target, 600);
  return <span className={`${styles.alertAmt} num`}>${Math.round(v)}</span>;
}

// ---- Rank-up: a popup when a viewer's running total crosses a tier threshold. ----
interface RankEvent {
  name: string;
  tier: string;
  top: boolean; // reached the LAST tier — gradient text + double ring pulse
  next: { name: string; delta: number } | null; // "$37 to Legend"
  ts: number;
}

// Fabricated rank-ups carry a plausible running total so the next-tier line shows real numbers.
const RANK_DEMO: { name: string; tier: string; total: number }[] = [
  { name: "Timur", tier: "VIP", total: 112 },
  { name: "anna_k", tier: "Regular", total: 31 },
  { name: "Whale", tier: "Legend", total: 540 },
];

const RANK_SHOW_MS = 5000; // must match the 5s alertCycle animation so the exit finishes on screen
const RANK_GAP_MS = 900; // empty stage between demo cards — the streamer judges real airtime

function rankEventFor(name: string, tier: string, total: number, ts: number): RankEvent {
  const idx = OVERLAY_TIERS.findIndex((t) => t.name === tier);
  const nextTier = idx >= 0 ? OVERLAY_TIERS[idx + 1] : undefined;
  return {
    name,
    tier,
    ts,
    top: idx === OVERLAY_TIERS.length - 1,
    next: nextTier ? { name: nextTier.name, delta: Math.max(1, Math.ceil(nextTier.at - total)) } : null,
  };
}

export function RankOverlay({ handle, demo }: Common) {
  const [current, setCurrent] = useState<RankEvent | null>(null);
  const totals = useRef<Record<string, number>>({});
  const nonce = useRef(0);

  // Totals survive an OBS Browser Source refresh. Loaded per handle before any stream event can
  // land (effects run in mount order and channel events are async).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`cheer-rank-totals:${handle}`);
      const obj = raw ? (JSON.parse(raw) as Record<string, number>) : null;
      totals.current = obj && typeof obj === "object" && !Array.isArray(obj) ? obj : {};
    } catch {
      totals.current = {};
    }
  }, [handle]);

  // Real rank-ups: a donation that pushes a viewer's running total past a tier threshold.
  useDonationStream(
    handle,
    (e) => {
      // Demo popups run on the paced loop below; fabricated stream events must not pollute the
      // persisted totals either, so the whole real path is skipped.
      if (demo) return;
      const prev = totals.current[e.from] ?? 0;
      const next = prev + e.amount;
      totals.current[e.from] = next;
      try {
        localStorage.setItem(`cheer-rank-totals:${handle}`, JSON.stringify(totals.current));
      } catch {}
      const crossed = OVERLAY_TIERS.filter((t) => prev < t.at && next >= t.at).pop();
      if (crossed) setCurrent(rankEventFor(e.from, crossed.name, next, ++nonce.current));
    },
    demo,
  );

  // Demo pacing: 5s on stage (the 5s animation plays entrance AND exit), ~900ms clear, then next.
  // The old 4.2s interval remounted cards mid-cycle, so the exit never played.
  useEffect(() => {
    if (!demo) return;
    let i = -1;
    let t = 0;
    const show = () => {
      i = (i + 1) % RANK_DEMO.length;
      const d = RANK_DEMO[i];
      setCurrent(rankEventFor(d.name, d.tier, d.total, ++nonce.current));
      t = window.setTimeout(hide, RANK_SHOW_MS);
    };
    const hide = () => {
      setCurrent(null);
      t = window.setTimeout(show, RANK_GAP_MS);
    };
    show();
    return () => window.clearTimeout(t);
  }, [demo]);

  // Auto-dismiss the real path (the demo path swaps on its own clock).
  useEffect(() => {
    if (!current || demo) return;
    const t = setTimeout(() => setCurrent(null), RANK_SHOW_MS);
    return () => clearTimeout(t);
  }, [current, demo]);

  return (
    <div className={`${styles.stage} ${styles.stageTop}`}>
      {current && (
        <div className={styles.rank} key={current.ts}>
          <span className={`${styles.rankBadge} ${current.top ? styles.rankBadgeTop : ""}`}>
            <CheerMark />
          </span>
          <div className={styles.alertBody}>
            <div className={styles.alertLine}>
              <b>{current.name}</b> reached{" "}
              <span className={`${styles.rankTier} ${current.top ? styles.rankTierTop : ""}`}>{current.tier}</span>
            </div>
            {current.next && (
              <div className={styles.rankNext}>
                <b className="num">${current.next.delta}</b> to {current.next.name}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Goal: a progress bar that grows with every donation. ----
const GOAL_NOTCHES = [25, 50, 75];

export function GoalOverlay({
  handle,
  demo,
  title = "Stream goal",
  goal = DEMO_GOAL,
  raised: raised0 = DEMO_GOAL_START,
}: Common & { title?: string; goal?: number; raised?: number }) {
  const [raised, setRaised] = useState(raised0);
  const [hit, setHit] = useState<{ from: string; amount: number; n: number } | null>(null);
  const [credit, setCredit] = useState<{ from: string; amount: number } | null>(null);
  const evN = useRef(0);

  useDonationStream(
    handle,
    (e) => {
      setRaised((r) => r + e.amount);
      setHit({ from: e.from, amount: e.amount, n: ++evN.current });
    },
    demo,
  );

  // Donor micro-credit under the track for 3s; a fresh donation restarts the clock (cleanup).
  useEffect(() => {
    if (!hit) return;
    setCredit({ from: hit.from, amount: hit.amount });
    const t = setTimeout(() => setCredit(null), 3000);
    return () => clearTimeout(t);
  }, [hit]);

  const shown = useCountUp(raised, 600);
  const pulseN = useChangeNonce(raised);

  const pct = Math.min(100, goal > 0 ? (raised / goal) * 100 : 0);

  // Milestone crossing flash: compare against the previous pct, one flash per notch crossed.
  const prevPct = useRef(pct);
  const [notchFlash, setNotchFlash] = useState(0);
  useEffect(() => {
    const from = prevPct.current;
    prevPct.current = pct;
    if (GOAL_NOTCHES.some((m) => from < m && pct >= m)) setNotchFlash((n) => n + 1);
  }, [pct]);

  // Goal-reached ceremony. Ref-guarded to fire once per below→above crossing — and seeded with the
  // initial state, so reloading an already-reached goal doesn't replay the ceremony.
  const reached = goal > 0 && raised >= goal;
  const reachedRef = useRef(goal > 0 && raised0 >= goal);
  const [ceremony, setCeremony] = useState(reachedRef.current);
  useEffect(() => {
    if (reached && !reachedRef.current) {
      reachedRef.current = true;
      setCeremony(true);
    } else if (!reached && reachedRef.current) {
      reachedRef.current = false;
      setCeremony(false);
    }
  }, [reached]);

  return (
    <div className={`${styles.stage} ${styles.stageBottom}`}>
      <div className={`${styles.goal} ${ceremony ? styles.goalCeremony : ""}`}>
        <div className={styles.goalTop}>
          <span className={styles.goalTitle}>{reached ? "Goal reached" : title}</span>
          <span className={`${styles.goalNums} num`}>
            {/* keyed remount replays the 350ms pulse per donation; counting continues past 100% */}
            <b key={pulseN} className={styles.goalRaised}>
              ${Math.round(shown)}
            </b>{" "}
            / ${goal}
          </span>
        </div>
        <div className={styles.goalTrackWrap}>
          {hit && (
            <span key={hit.n} className={`${styles.goalChip} num`} style={{ left: `${Math.min(96, Math.max(4, pct))}%` }}>
              +${hit.amount}
            </span>
          )}
          <div className={styles.goalTrack}>
            <div className={`${styles.goalFill} ${pct > 2 ? styles.goalFillCap : ""}`} style={{ width: `${pct}%` }} />
            {GOAL_NOTCHES.map((m) => (
              <span key={m} className={styles.goalNotch} style={{ left: `${m}%` }} />
            ))}
          </div>
          {notchFlash > 0 && <span key={notchFlash} className={styles.goalTrackFlash} />}
        </div>
        {credit && (
          <div className={styles.goalCredit}>
            {credit.from} <b className="num">+${credit.amount}</b>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Top donors: a live leaderboard, aggregated by name. ----
const DEMO_SEED: Record<string, number> = { Timur: 120, anna_k: 75, Whale: 50 };

export function TopOverlay({ handle, demo, n }: Common & { n?: number }) {
  const [totals, setTotals] = useState<Record<string, number>>(demo ? { ...DEMO_SEED } : {});
  useDonationStream(handle, (e) => setTotals((t) => ({ ...t, [e.from]: (t[e.from] ?? 0) + e.amount })), demo);

  // ?n= sets how many places the leaderboard shows (default 5, clamped 1–10).
  const count = Math.min(10, Math.max(1, Math.round(n ?? 5)));
  const rows = Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, count);

  // The header's session total folds the same stream — everything received since mount (+seed).
  const session = Object.values(totals).reduce((s, v) => s + v, 0);
  const sessionShown = useCountUp(session, 500);

  const listRef = useRef<HTMLDivElement>(null);
  useFlip(listRef, rows.map(([name, t]) => `${name}:${t}`).join("|"));

  return (
    <div className={`${styles.stage} ${styles.stageLeft}`}>
      <div className={styles.top}>
        <div className={styles.topHead}>
          Top donors
          {session > 0 && <span className={`${styles.topSession} num`}>${Math.round(sessionShown)}</span>}
        </div>
        {rows.length === 0 ? (
          <div className={styles.topEmpty}>Waiting for donations…</div>
        ) : (
          <div ref={listRef}>
            {rows.map(([name, total], i) => (
              <TopRow key={name} name={name} total={total} rank={i + 1} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TopRow({ name, total, rank }: { name: string; total: number; rank: number }) {
  const shown = useCountUp(total, 500);
  const flashN = useChangeNonce(total); // 0 on first paint — a fresh row enters via FLIP, no flash
  return (
    <div className={styles.topRow} data-flip-key={name}>
      {flashN > 0 && <span key={flashN} className={styles.rowFlash} />}
      <span className={styles.topRank}>
        {rank === 1 ? (
          // Rows are keyed by name, so this element mounts fresh exactly when a different row
          // becomes first — the spring-in plays on every leader change, and only then.
          <span className={styles.topCheer}>
            <CheerMark width={14} height={14} />
          </span>
        ) : (
          rank
        )}
      </span>
      <span className={styles.topName}>{name}</span>
      <span className={`${styles.topAmt} num`}>${Math.round(shown)}</span>
    </div>
  );
}

// ---- Roulette: the real wheel + top-3 bars. Polls the shared round store; ?demo=1 runs a fully
// fabricated in-state loop (grow → spin → hold → reset) since OBS starts with empty localStorage. ----
const SPIN_MS = 4400; // RouletteWheel's own spin clock (4.2s transition + settle)
const ROU_GROW_MS = 3500;
const ROU_SPIN_AT_MS = 45000;
const ROU_HOLD_MS = 6000;

export function RouletteOverlay({ handle, demo }: Common) {
  const [round, setRound] = useState<RouletteSuggestion[]>([]);
  const [winner, setWinner] = useState<{ id: string; title: string } | null>(null);
  const [landed, setLanded] = useState(false); // the winner line reveals only via onLanded
  const [spin, setSpin] = useState<{ id: string | null; nonce: number }>({ id: null, nonce: 0 });
  const spunFor = useRef<string | null>(null); // ref-guard: one spin per verdict, across 1.5s polls
  const roundRef = useRef(round);
  roundRef.current = round;

  // Real path: poll the store; spin the wheel the first time a verdict appears.
  useEffect(() => {
    if (demo) return;
    let first = true;
    const load = () => {
      const scope = firstActiveScope(handle, "roulette");
      const next = readRound(scope);
      // Change guard: don't re-render every 1.5s for hours when nothing moved.
      setRound((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
      const w = readRoundMeta(scope)?.winner ?? null;
      if (w && spunFor.current !== w.id) {
        spunFor.current = w.id;
        setWinner(w);
        if (first) {
          // Opened after the verdict: the wheel parks itself — replaying the spin would be theater.
          setLanded(true);
        } else {
          setLanded(false);
          setSpin((s) => ({ id: w.id, nonce: s.nonce + 1 }));
        }
      } else if (!w && spunFor.current) {
        // A new round started — clear the old verdict.
        spunFor.current = null;
        setWinner(null);
        setLanded(false);
      }
      first = false;
    };
    load();
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, [handle, demo]);

  // Demo loop, entirely in component state (never touches the stores or the channel):
  // pools grow every ~3.5s, auto-spin at ~45s, hold the winner 6s, reset.
  useEffect(() => {
    if (!demo) return;
    const timers: number[] = [];
    const seed = () => MOCK_ROUND.map((s) => ({ ...s }));
    const cycle = () => {
      timers.splice(0); // every previous timer has fired — keep the list from growing for hours
      spunFor.current = null;
      setRound(seed());
      setWinner(null);
      setLanded(false);
      const grow = window.setInterval(() => {
        setRound((r) => {
          if (r.length === 0) return r;
          const i = Math.floor(Math.random() * r.length);
          const bump = 5 + Math.floor(Math.random() * 21);
          return r.map((s, j) => (j === i ? { ...s, pool: s.pool + bump, backers: s.backers + 1 } : s));
        });
      }, ROU_GROW_MS);
      timers.push(grow);
      timers.push(
        window.setTimeout(() => {
          window.clearInterval(grow);
          const rows = roundRef.current;
          const w = pickWeighted(rows, Math.random()) ?? rows[0];
          if (w) {
            spunFor.current = w.id;
            setWinner({ id: w.id, title: w.title });
            setLanded(false);
            setSpin((s) => ({ id: w.id, nonce: s.nonce + 1 }));
          }
          timers.push(window.setTimeout(cycle, SPIN_MS + ROU_HOLD_MS));
        }, ROU_SPIN_AT_MS),
      );
    };
    cycle();
    return () =>
      timers.forEach((t) => {
        window.clearTimeout(t);
        window.clearInterval(t);
      });
  }, [demo]);

  const total = round.reduce((s, r) => s + r.pool, 0);
  const shownPot = useCountUp(total, 500);
  const rows = useMemo(() => [...round].sort((a, b) => b.pool - a.pool).slice(0, 3), [round]);

  return (
    <div className={`${styles.stage} ${styles.stageLeft}`}>
      <div className={`${styles.game} ${styles.gameRoulette}`}>
        <div className={styles.gameHead}>
          <GameIcon id="roulette" width={16} height={16} />
          Roulette
          <span className={`${styles.gamePot} num`}>${Math.round(shownPot)} pot</span>
        </div>
        <div className={styles.rouSplit}>
          {/* `landed` toggles off before every new spin, so the glow fade replays per verdict */}
          <div className={`${styles.rouWheel} ${landed ? styles.rouWheelGlow : ""}`}>
            <RouletteWheel
              round={round}
              compact
              size={160}
              spinToId={spin.id}
              spinNonce={spin.nonce}
              winnerId={winner?.id ?? null}
              onLanded={() => setLanded(true)}
            />
          </div>
          <div className={styles.rouRows}>
            {landed && winner ? (
              <div className={styles.gameWinner}>
                <span className={styles.winnerMark}>
                  <CheerMark width={18} height={18} />
                </span>
                {winner.title}
              </div>
            ) : rows.length === 0 ? (
              <div className={styles.gameSub}>no games on the wheel yet</div>
            ) : (
              rows.map((r) => (
                <RouRow key={r.id} title={r.title} pool={r.pool} pct={total > 0 ? Math.round((r.pool / total) * 100) : 0} />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function RouRow({ title, pct, pool }: { title: string; pct: number; pool: number }) {
  const n = useChangeNonce(pool); // 0 until this row's pool actually grows
  return (
    <div className={styles.gameRow}>
      {n > 0 && <span key={`f${n}`} className={styles.rowFlash} />}
      <span className={styles.gameName}>{title}</span>
      <span className={styles.gameBar}>
        <span style={{ width: `${pct}%` }} />
      </span>
      <span key={`p${n}`} className={`${styles.gamePct} num ${n > 0 ? styles.pctPop : ""}`}>
        {pct}%
      </span>
    </div>
  );
}

// ---- Task: the active paid task with countdown + elapsed bar. Polls the shared task store. ----
const TASK_DONE_HOLD_MS = 3500; // payout frame airtime before the 300ms fade
const TASK_DONE_FADE_MS = 300;

const TASK_DEMO: { from: string; amount: number; text: string }[] = [
  { from: "Timur", amount: 50, text: "Beat the first boss with no armor on." },
  { from: "anna_k", amount: 25, text: "Speak only in rhymes for one full game." },
  { from: "Max", amount: 40, text: "Play the next round on inverted controls." },
];

export function TaskOverlay({ handle, demo }: Common) {
  const [task, setTask] = useState<GameTask | null>(null);
  const [done, setDone] = useState<{ t: GameTask; hold: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // SPEC DEVIATION: the spec asks for "activation ts + duration", but GameTask carries only a
  // human "when" string — no numeric timestamp exists in the store. We clock from the moment THIS
  // overlay first sees a task active; durationHours (the donor's knob) still sets the length,
  // defaulting to 1h when the donor never picked one.
  const activatedAt = useRef<Map<string, number>>(new Map());
  const shownId = useRef<string | null>(null);
  const hadTask = useRef(false); // false → slide-up entrance, true → cross-fade swap
  const doneHold = useRef(false);
  const doneTimer = useRef(0);

  // Real path: poll, differentiate states, and hold a payout frame when the shown task completes.
  useEffect(() => {
    if (demo) return;
    const load = () => {
      const all = readTasks(firstActiveScope(handle, "task"));
      const nowTs = Date.now();
      for (const t of all) if (t.state === "active" && !activatedAt.current.has(t.id)) activatedAt.current.set(t.id, nowTs);
      // Prune clocks for tasks gone from the store — the map must not grow for hours in OBS.
      if (activatedAt.current.size > 24) {
        const ids = new Set(all.map((t) => t.id));
        for (const id of Array.from(activatedAt.current.keys())) if (!ids.has(id)) activatedAt.current.delete(id);
      }
      if (doneHold.current) return; // frozen on the payout frame until its own timer clears it
      const shown = shownId.current ? all.find((t) => t.id === shownId.current) : undefined;
      if (shown && shown.state === "done") {
        // Note: removeTask deletes completed tasks outright — the ceremony plays when the cabinet
        // marks "done" first; a task that simply vanished just advances to the next one.
        doneHold.current = true;
        setDone({ t: shown, hold: TASK_DONE_HOLD_MS });
        setTask(null);
        shownId.current = null;
        doneTimer.current = window.setTimeout(() => {
          doneHold.current = false;
          setDone(null);
        }, TASK_DONE_HOLD_MS + TASK_DONE_FADE_MS);
        return;
      }
      const next = all.find((t) => t.state === "active") ?? all.find((t) => t.state === "pending") ?? null;
      if ((next?.id ?? null) !== shownId.current) {
        hadTask.current = shownId.current !== null;
        shownId.current = next?.id ?? null;
        setTask(next);
      } else if (next) {
        // Same task — only re-render when its state flipped (pending → active).
        setTask((cur) => (cur && cur.state === next.state ? cur : next));
      }
    };
    load();
    const t = setInterval(load, 1500);
    return () => {
      clearInterval(t);
      clearTimeout(doneTimer.current);
    };
  }, [handle, demo]);

  // Demo: three canned tasks cycling pending(4s) → active(7s) → done(~3s) ≈ 14s, in state only.
  useEffect(() => {
    if (!demo) return;
    const timers: number[] = [];
    let i = 0;
    const cycle = () => {
      timers.splice(0);
      activatedAt.current.clear(); // demo mints a new id per cycle — don't accumulate clocks
      const base = TASK_DEMO[i % TASK_DEMO.length];
      i += 1;
      const id = `demo-${i}`;
      // 0.15h = 9 minutes: short enough that the mm:ss countdown AND the <10min accent both show.
      const t: GameTask = { id, ...base, state: "pending", when: "just now", durationHours: 0.15 };
      hadTask.current = i > 1;
      shownId.current = id;
      setDone(null);
      setTask(t);
      timers.push(
        window.setTimeout(() => {
          activatedAt.current.set(id, Date.now());
          setTask({ ...t, state: "active" });
        }, 4000),
      );
      timers.push(
        window.setTimeout(() => {
          setTask(null);
          shownId.current = null;
          setDone({ t: { ...t, state: "done" }, hold: 2900 }); // 2.9s + fade fits before the next cycle
        }, 11000),
      );
      timers.push(window.setTimeout(cycle, 14200));
    };
    cycle();
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [demo]);

  // Tick the countdown once a second — only while an active task is on screen.
  useEffect(() => {
    if (!task || task.state !== "active") return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [task]);

  if (done) {
    return (
      <div className={`${styles.stage} ${styles.stageBottom}`}>
        <div
          key={`done-${done.t.id}`}
          className={`${styles.game} ${styles.taskCard} ${styles.taskDoneCard}`}
          style={{ "--hold": `${done.hold}ms` } as CSSProperties}
        >
          <div className={styles.gameHead}>
            <GameIcon id="task" width={16} height={16} />
            Task
            <span className={`${styles.gamePot} num`}>${done.t.amount}</span>
          </div>
          <div className={styles.gameText}>{done.t.text}</div>
          <div className={styles.taskDoneLine}>
            Done · <b className="num">+${done.t.amount}</b>
          </div>
        </div>
      </div>
    );
  }

  if (!task) return <div className={`${styles.stage} ${styles.stageBottom}`} />;

  const active = task.state === "active";
  const durMs = Math.max(60_000, (task.durationHours ?? 1) * 3_600_000);
  const t0 = activatedAt.current.get(task.id) ?? now;
  const leftMs = Math.min(durMs, Math.max(0, t0 + durMs - now));
  const mm = Math.floor(leftMs / 60_000);
  const ss = Math.floor((leftMs % 60_000) / 1000);
  const elapsedPct = Math.min(100, ((durMs - leftMs) / durMs) * 100);

  return (
    <div className={`${styles.stage} ${styles.stageBottom}`}>
      <div
        key={task.id}
        className={`${styles.game} ${styles.taskCard} ${active ? styles.taskActive : ""} ${
          hadTask.current ? styles.taskSwap : styles.taskIn
        }`}
      >
        <div className={styles.gameHead}>
          <GameIcon id="task" width={16} height={16} />
          Task
          {active && (
            <span className={`${styles.taskClock} num ${leftMs < 600_000 ? styles.taskClockUrgent : ""}`}>
              {String(mm).padStart(2, "0")}:{String(ss).padStart(2, "0")}
            </span>
          )}
          <span className={`${styles.gamePot} num`}>${task.amount}</span>
        </div>
        <div className={styles.gameText}>{task.text}</div>
        {active && (
          <div className={styles.taskBar}>
            <span style={{ width: `${elapsedPct}%` }} />
          </div>
        )}
        <div className={styles.gameSub}>
          {task.from}
          {!active && (
            <>
              {" · "}
              <span className={styles.taskPendingNote}>awaiting approval</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Auction: the live lot board with overtake pricing, or the SOLD ceremony at the bell. ----
type AuctionPhase = "board" | "closing" | "sold";
const AUC_COLLAPSE_MS = 320;

export function AuctionOverlay({ handle, demo }: Common) {
  const [board, setBoard] = useState<AuctionLot[]>([]);
  const [winner, setWinner] = useState<AuctionLot | null>(null);
  const [phase, setPhase] = useState<AuctionPhase>("board");
  const soldFor = useRef<string | null>(null); // ref-guard: one ceremony per verdict
  const phaseTimer = useRef(0);
  const boardRef = useRef(board);
  boardRef.current = board;
  const listRef = useRef<HTMLDivElement>(null);

  // Real path: poll the lot book; run the sold ceremony the first time a winner appears.
  useEffect(() => {
    if (demo) return;
    let first = true;
    const load = () => {
      const scope = firstActiveScope(handle, "auction");
      const lots = readLots(scope);
      const meta = readAuctionMeta(scope);
      const lb = leaderboard(lots).slice(0, 3);
      setBoard((prev) => (JSON.stringify(prev) === JSON.stringify(lb) ? prev : lb));
      const w = meta?.winnerId ? lots.find((l) => l.id === meta.winnerId) ?? null : null;
      if (w && soldFor.current !== w.id) {
        soldFor.current = w.id;
        setWinner(w);
        if (first) {
          setPhase("sold"); // opened after the bell — show the verdict, don't replay the collapse
        } else {
          setPhase("closing");
          phaseTimer.current = window.setTimeout(() => setPhase("sold"), AUC_COLLAPSE_MS);
        }
      } else if (!w && soldFor.current) {
        soldFor.current = null;
        setWinner(null);
        setPhase("board");
      }
      first = false;
    };
    load();
    const t = setInterval(load, 1500);
    return () => {
      clearInterval(t);
      clearTimeout(phaseTimer.current);
    };
  }, [handle, demo]);

  // Demo: a two-lot bid war in state — the trailing lot raises every ~4s (the lead keeps
  // flipping), the bell at ~50s, SOLD holds 6s, then the board resets.
  useEffect(() => {
    if (!demo) return;
    const timers: number[] = [];
    const seed = (): AuctionLot[] => [
      {
        id: "d1",
        from: "Whale",
        text: "Finish the map on the hardest difficulty — no saves.",
        state: "accepted",
        when: "just now",
        entries: [{ name: "Whale", amount: 60, when: "just now" }],
      },
      {
        id: "d2",
        from: "anna_k",
        text: "Full playthrough with your cam upside down.",
        state: "accepted",
        when: "just now",
        entries: [{ name: "anna_k", amount: 55, when: "just now" }],
      },
    ];
    const cycle = () => {
      timers.splice(0); // every previous timer has fired
      soldFor.current = null;
      setWinner(null);
      setPhase("board");
      setBoard(seed());
      const raise = window.setInterval(() => {
        setBoard((b) => {
          if (b.length < 2) return b;
          const sorted = [...b].sort((x, y) => lotSum(y) - lotSum(x));
          const trailing = sorted[sorted.length - 1];
          const bump = 5 + Math.floor(Math.random() * 16);
          // One entry per lot whose amount grows — no unbounded entries array in an hours-long loop.
          return b.map((l) =>
            l.id === trailing.id ? { ...l, entries: [{ ...l.entries[0], amount: lotSum(l) + bump }] } : l,
          );
        });
      }, 4000);
      timers.push(raise);
      timers.push(
        window.setTimeout(() => {
          window.clearInterval(raise);
          const w = [...boardRef.current].sort((x, y) => lotSum(y) - lotSum(x))[0] ?? null;
          if (w) {
            soldFor.current = w.id;
            setWinner(w);
            setPhase("closing");
            timers.push(window.setTimeout(() => setPhase("sold"), AUC_COLLAPSE_MS));
          }
          timers.push(window.setTimeout(cycle, 6000 + AUC_COLLAPSE_MS));
        }, 50000),
      );
    };
    cycle();
    return () =>
      timers.forEach((t) => {
        window.clearTimeout(t);
        window.clearInterval(t);
      });
  }, [demo]);

  const rows = useMemo(() => [...board].sort((a, b) => lotSum(b) - lotSum(a)), [board]);
  const top = rows[0] ? lotSum(rows[0]) : 0;
  const leaderId = rows[0]?.id ?? null;
  const headSum = useCountUp(winner ? lotSum(winner) : top, 500);
  useFlip(listRef, rows.map((l) => `${l.id}:${lotSum(l)}`).join("|"));

  return (
    <div className={`${styles.stage} ${styles.stageLeft}`}>
      <div className={`${styles.game} ${styles.gameAuction} ${phase === "sold" ? styles.aucSoldCard : ""}`}>
        <div className={styles.gameHead}>
          <GameIcon id="auction" width={16} height={16} />
          Auction
          <span className={`${styles.gamePot} num`}>
            ${Math.round(headSum)} {winner ? "sold" : "leads"}
          </span>
        </div>
        {phase === "sold" && winner ? (
          <div>
            <div className={styles.gameText}>“{winner.text}”</div>
            <div className={styles.aucStamp}>
              SOLD <b className="num">${lotSum(winner)}</b> · {winner.from}
              <span className={styles.aucUnderline} />
            </div>
          </div>
        ) : rows.length === 0 ? (
          <div className={styles.gameSub}>no lots on the board yet</div>
        ) : (
          <div ref={listRef} className={phase === "closing" ? styles.aucClosing : undefined}>
            {rows.map((l) => (
              <AucRow key={l.id} lot={l} top={top} leader={l.id === leaderId} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AucRow({ lot, top, leader }: { lot: AuctionLot; top: number; leader: boolean }) {
  const sum = lotSum(lot);
  const shown = useCountUp(sum, 500);
  const leadN = useChangeNonce(leader); // increments on takeover — replays the tick + flash
  const pct = top > 0 ? Math.round((sum / top) * 100) : 0;
  return (
    <div className={styles.gameRow} data-flip-key={lot.id}>
      {leader && leadN > 0 && <span key={leadN} className={styles.rowFlash} />}
      {leader && <span key={`t${leadN}`} className={styles.leadTick} />}
      <span className={styles.gameName}>{lot.text}</span>
      <span className={styles.gameBar}>
        <span style={{ width: `${pct}%` }} />
      </span>
      <span className={`${styles.gamePct} num`}>${Math.round(shown)}</span>
      {!leader && (
        <span className={styles.aucGap}>
          +<b className="num">${Math.max(1, top - sum)}</b> to lead
        </span>
      )}
    </div>
  );
}

// ---- Fundraiser: the campaign figure fills toward the goal as viewers chip in. Polls. ----
export function FundraiserOverlay({ handle, demo, goal: goalProp, img }: Common & { goal?: number; img?: string }) {
  // Goal precedence: explicit ?goal= from the overlay URL wins; otherwise the streamer's real
  // fundraiser draft (spec: withFundraiserDefaults); DEMO fallback covers unresolved handles —
  // so overlay and public page never show different targets for a real campaign.
  const { profile } = usePublicProfile(handle);
  const goal = goalProp && goalProp > 0 ? goalProp : profile ? withFundraiserDefaults(profile).goal : DEMO_FUNDRAISER_GOAL;

  const [raised, setRaised] = useState(0);
  const [chip, setChip] = useState<{ amount: number; name?: string; n: number } | null>(null);
  const chipN = useRef(0);
  const prevRaised = useRef<number | null>(null);

  // Real path: poll the store total. The store exposes only a running sum — real chip-ins can't
  // carry a donor name (the demo fabricates one), so the rising chip shows the amount alone.
  useEffect(() => {
    if (demo) return;
    const load = () => {
      const next = raisedTotal(firstActiveScope(handle, "fundraiser"));
      const prev = prevRaised.current;
      prevRaised.current = next;
      if (prev !== null && next > prev) setChip({ amount: Math.round(next - prev), n: ++chipN.current });
      setRaised(next);
    };
    load();
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, [handle, demo]);

  // Demo: fabricated chip-ins on top of the seeded raised, in state only — the figure visibly
  // climbs toward the goal in OBS's empty-localStorage browser.
  useEffect(() => {
    if (!demo) return;
    setRaised(raisedTotal(firstActiveScope(handle, "fundraiser")));
    const t = setInterval(() => {
      const amount = 5 + Math.floor(Math.random() * 46);
      setChip({ amount, name: pickName(), n: ++chipN.current });
      setRaised((r) => r + amount);
    }, 5000);
    return () => clearInterval(t);
  }, [demo, handle]);

  const shownRaised = useCountUp(raised, 600);
  const pct = Math.min(1, goal > 0 ? raised / goal : 0);
  const isFull = goal > 0 && raised >= goal;
  const pctN = useChangeNonce(isFull ? -1 : Math.round(pct * 100));

  // Funded flash: one-shot on the below→above crossing only — reloading an already-funded
  // campaign must not replay the ceremony.
  const wasFull = useRef<boolean | null>(null);
  const [fx, setFx] = useState(0);
  useEffect(() => {
    if (wasFull.current === null) {
      wasFull.current = isFull;
      return;
    }
    if (isFull && !wasFull.current) setFx((n) => n + 1);
    wasFull.current = isFull;
  }, [isFull]);

  return (
    <div className={`${styles.stage} ${styles.stageBottom}`}>
      <div className={styles.fund}>
        {chip && (
          <span key={chip.n} className={styles.fundChip}>
            <b className="num">+${chip.amount}</b>
            {chip.name && <span className={styles.fundChipName}> {chip.name}</span>}
          </span>
        )}
        <div key={`fx${fx}`} className={`${styles.fundFigure} ${fx > 0 ? styles.fundFunded : ""}`}>
          <FundraiserFill pct={pct} size={84} image={img} />
        </div>
        <div className={styles.fundBody}>
          <div key={pctN} className={`${styles.fundPct} ${pctN > 0 ? styles.fundPctPop : ""}`}>
            {isFull ? "Funded" : `${Math.round(pct * 100)}%`}
          </div>
          <div className={`${styles.fundNums} num`}>
            <b>${Math.round(shownRaised)}</b> / ${goal}
          </div>
        </div>
      </div>
    </div>
  );
}
