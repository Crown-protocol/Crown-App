"use client";

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Mono } from "@/components/Mono";
import { CheerMark } from "@/components/icons";
import { useDonationStream } from "@/lib/data/useDonationStream";
import { usd } from "@/lib/money";
import { useCountUp, useChangeNonce } from "@/components/overlays/fx";
import type { DonationEvent } from "@/lib/data/donationStream";
import styles from "./Extras.module.css";

// Five general overlay widgets (batch 2): ticker strip, donate QR, session total, stream record,
// donation train. All donation-driven state comes from the BroadcastChannel stream; these run for
// hours inside OBS, so every timer/rAF/animation is cleaned up and every list is capped.

interface Common {
  handle: string;
  demo?: boolean;
}

// ---- Ticker: a thin full-width strip of recent donations, session total pinned right. ----

interface TickerEntry {
  id: number;
  from: string;
  amount: number;
}

const TICKER_CAP = 15; // "keeps the last ~15 donations" — also the memory bound for an hours-long run

// Demo seed shown synchronously on mount so the strip is full on frame one (spec demoBehavior).
const TICKER_SEED: Omit<TickerEntry, "id">[] = [
  { from: "Timur", amount: 25 },
  { from: "anna_k", amount: 10 },
  { from: "Whale", amount: 50 },
  { from: "lesya", amount: 5 },
  { from: "Dan", amount: 10 },
  { from: "Julia", amount: 3 },
];

export function TickerOverlay({ handle, demo }: Common) {
  const seedCount = demo ? TICKER_SEED.length : 0;
  const idRef = useRef(seedCount);
  const [entries, setEntries] = useState<TickerEntry[]>(() =>
    demo ? TICKER_SEED.map((e, i) => ({ id: i + 1, ...e })) : [],
  );
  const [sessionTotal, setSessionTotal] = useState(() =>
    demo ? TICKER_SEED.reduce((s, e) => s + e.amount, 0) : 0,
  );

  useDonationStream(
    handle,
    (e) => {
      const id = ++idRef.current;
      setEntries((xs) => [...xs, { id, from: e.from, amount: e.amount }].slice(-TICKER_CAP));
      setSessionTotal((t) => t + e.amount);
    },
    demo,
  );

  const totalShown = useCountUp(sessionTotal, 400);
  const latestId = entries.length ? entries[entries.length - 1].id : 0;

  // Seamless marquee: the track holds TWO copies of the entry list and loops translateX 0 → -50%.
  // Driven via WAAPI instead of a CSS animation-duration so that when entries are appended we can
  // re-time in place while preserving the loop FRACTION — a plain duration change on a running CSS
  // animation would make the strip visibly jump. Keyframes are %-based, so the fraction is the
  // position. Target speed ~40px/s per spec.
  const trackRef = useRef<HTMLDivElement | null>(null);
  const marquee = useRef<Animation | null>(null);
  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el || entries.length === 0) return;
    const half = el.scrollWidth / 2; // one copy = one full loop
    const durMs = Math.max(4000, (half / 40) * 1000);
    const anim = marquee.current;
    if (!anim || !anim.effect) {
      marquee.current = el.animate(
        [{ transform: "translateX(0)" }, { transform: "translateX(-50%)" }],
        { duration: durMs, iterations: Infinity, easing: "linear" },
      );
    } else {
      const prevDur = Number(anim.effect.getTiming().duration) || durMs;
      const frac = (Number(anim.currentTime ?? 0) % prevDur) / prevDur;
      anim.effect.updateTiming({ duration: durMs });
      anim.currentTime = frac * durMs;
    }
  }, [entries]);
  useEffect(
    () => () => {
      marquee.current?.cancel();
      marquee.current = null; // so a StrictMode re-mount builds a fresh animation, not a cancelled one
    },
    [],
  );

  const group = (ariaHidden: boolean) => (
    <div className={styles.tickerGroup} aria-hidden={ariaHidden}>
      {entries.map((e) => (
        <Fragment key={e.id}>
          <span
            // Only live entries flash (id past the seed) — the demo seed must not light up on mount.
            className={
              e.id === latestId && e.id > seedCount
                ? `${styles.tickerEntry} ${styles.tickerEntryNew}`
                : styles.tickerEntry
            }
          >
            <span className={styles.tickerName}>{e.from}</span>
            <span className={`${styles.tickerAmt} num`}>{usd(e.amount)}</span>
          </span>
          {/* trailing dot on every entry so the loop seam is spaced exactly like the interior */}
          <span className={styles.tickerDot} />
        </Fragment>
      ))}
    </div>
  );

  return (
    <div className={styles.stripStage}>
      <div className={styles.ticker}>
        <div className={styles.tickerViewport}>
          <div className={styles.tickerTrack} ref={trackRef}>
            {group(false)}
            {group(true)}
          </div>
        </div>
        <span className={styles.tickerCap}>
          Tonight <b className="num">${Math.round(totalShown)}</b>
        </span>
      </div>
    </div>
  );
}

// ---- QR: an always-on corner donate code; reacts to live donations with a sweep + microline. ----

export function QrOverlay({ handle, demo }: Common) {
  // Resolve the real host after mount (dev vs prod) — same pattern as WidgetsPanel.overlayUrl,
  // same fallback host. The QR points at the DONATE page, not at the overlay itself.
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const url = `${origin || "https://cheer.tv"}/@${handle}`;

  const [qr, setQr] = useState("");
  useEffect(() => {
    // WidgetsPanel recipe: light modules on transparent. Width 260 = 2× the 130px display size so
    // the code stays crisp on a scaled OBS canvas.
    QRCode.toDataURL(url, { margin: 1, width: 260, color: { dark: "#F1EFF7", light: "#00000000" } })
      .then(setQr)
      .catch(() => setQr(""));
  }, [url]);

  // Latest donation drives the one-shot underline sweep + the 3s microline; both keyed by ts.
  const [last, setLast] = useState<DonationEvent | null>(null);
  useDonationStream(handle, (e) => setLast(e), demo);
  useEffect(() => {
    if (!last) return;
    const t = setTimeout(() => setLast(null), 3000);
    return () => clearTimeout(t);
  }, [last]);

  return (
    <div className={`${styles.stage} ${styles.stageBottomRight}`}>
      <div className={styles.qr}>
        <div className={styles.qrHead}>Cheer</div>
        <span className={styles.qrRule}>{last && <span key={last.ts} className={styles.qrSweep} />}</span>
        {qr ? (
          // eslint-disable-next-line @next/next/no-img-element -- data URI, not an optimizable asset
          <img className={styles.qrImg} src={qr} alt="" />
        ) : (
          <span className={styles.qrImg} />
        )}
        <div className={styles.qrHandle}>@{handle}</div>
        {/* fixed-height slot so the microline appearing never jiggles the corner card */}
        <div className={styles.qrMicroSlot}>
          {last && (
            <div key={last.ts} className={styles.qrMicro}>
              {last.from} just gave <b className="num">{usd(last.amount)}</b>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Session: a minimal pill with the stream total, odometer-rolling per donation. ----

const ODO_DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

// Odometer number: each digit is a column of 0-9 that translateY-slides to its value over 450ms,
// staggered 40ms right-to-left. Columns are KEYED FROM THE RIGHT so when the number gains a digit
// ($999 → $1,004) the trailing columns keep identity and roll instead of remounting.
function Odometer({ value }: { value: number }) {
  const text = "$" + Math.round(value).toLocaleString("en-US");
  const chars = Array.from(text);
  const fromRight: number[] = new Array(chars.length).fill(0);
  let seen = 0;
  for (let i = chars.length - 1; i >= 0; i--) {
    if (chars[i] >= "0" && chars[i] <= "9") fromRight[i] = seen++;
  }
  return (
    <span className={`${styles.odo} num`} aria-label={text}>
      {chars.map((ch, i) => {
        const k = chars.length - i;
        if (ch < "0" || ch > "9") {
          return (
            <span key={`s${k}`} className={styles.odoStatic}>
              {ch}
            </span>
          );
        }
        const d = ch.charCodeAt(0) - 48;
        return (
          <span key={`d${k}`} className={styles.odoCol}>
            <span
              className={styles.odoStrip}
              style={{ transform: `translateY(-${d}em)`, transitionDelay: `${fromRight[i] * 40}ms` }}
            >
              {ODO_DIGITS.map((n) => (
                <span key={n}>{n}</span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}

export function SessionOverlay({ handle, demo, start }: Common & { start?: number }) {
  // Demo seeds $327 so the digit-roll show is visible within seconds (spec). The count seed is not
  // specified — 12 keeps the meta line plausible next to $327.
  const [total, setTotal] = useState(() => (demo ? 327 : 0));
  const [count, setCount] = useState(() => (demo ? 12 : 0));

  // ?start=<unix> anchors the session start: events stamped before it don't count toward "this
  // stream" (e.g. a stale publish from another tab). Accepts seconds or milliseconds.
  const startMs = start === undefined ? undefined : start < 1e12 ? start * 1000 : start;

  useDonationStream(
    handle,
    (e) => {
      if (startMs !== undefined && e.ts < startMs) return;
      setTotal((t) => t + e.amount);
      setCount((c) => c + 1);
    },
    demo,
  );

  // Nonce keys the dot's one-shot blink; 0 on mount so the seed doesn't blink.
  const blink = useChangeNonce(count);

  return (
    <div className={`${styles.stage} ${styles.stageTopLeft}`}>
      <div className={styles.session}>
        {blink > 0 ? (
          <span key={blink} className={`${styles.sessionDot} ${styles.sessionDotBlink}`} />
        ) : (
          <span className={styles.sessionDot} />
        )}
        <span className={styles.sessionAmt}>
          <Odometer value={total} />
        </span>
        <span className={styles.sessionMeta}>
          this stream · {count} {count === 1 ? "donation" : "donations"}
        </span>
      </div>
    </div>
  );
}

// ---- Record: the biggest single donation of the day, with a coronation when beaten. ----

interface RecordHolder {
  from: string;
  amount: number;
}

function recordKey(handle: string): string {
  return `cheer-record:${handle.toLowerCase()}`;
}

// Local date (en-CA gives YYYY-MM-DD) — "the day's record" should roll at the streamer's midnight,
// not UTC's.
function todayStr(): string {
  return new Date().toLocaleDateString("en-CA");
}

function readStoredRecord(handle: string): RecordHolder | null {
  try {
    const raw = localStorage.getItem(recordKey(handle));
    if (!raw) return null;
    const v = JSON.parse(raw) as { date?: string; from?: string; amount?: number };
    if (v && v.date === todayStr() && typeof v.from === "string" && typeof v.amount === "number") {
      return { from: v.from, amount: v.amount };
    }
  } catch {}
  return null;
}

function writeStoredRecord(handle: string, rec: RecordHolder): void {
  try {
    localStorage.setItem(recordKey(handle), JSON.stringify({ date: todayStr(), ...rec }));
  } catch {}
}

const RECORD_DEMO_NAMES = ["Maximus", "Julia", "Whale", "Dan", "anna_k"];

export function RecordOverlay({ handle, demo }: Common) {
  // Demo seeds a $25 record synchronously so the card is populated on frame one.
  const [rec, setRec] = useState<RecordHolder | null>(() => (demo ? { from: "Timur", amount: 25 } : null));
  const [prev, setPrev] = useState<RecordHolder | null>(null); // outgoing holder line during the flip
  const [ceremony, setCeremony] = useState(0); // >0 keys the one-shot break animations
  const recRef = useRef(rec);
  recRef.current = rec;

  // A new max. Ceremony fires only when an EXISTING record falls — the first record of the day (and
  // the localStorage restore below) just appears, so a refresh never replays the coronation.
  const beat = (from: string, amount: number) => {
    const cur = recRef.current;
    if (cur && amount <= cur.amount) return;
    if (cur) {
      setPrev(cur);
      setCeremony((n) => n + 1);
    }
    setRec({ from, amount });
    // Demo records stay in component state only — never pollute the real per-day storage.
    if (!demo) writeStoredRecord(handle, { from, amount });
  };
  const beatRef = useRef(beat);
  beatRef.current = beat;

  // Restore today's record so an OBS Browser Source refresh keeps the challenge standing. Merge by
  // max in case a live donation raced in before this effect ran.
  useEffect(() => {
    if (demo) return;
    const saved = readStoredRecord(handle);
    if (saved) setRec((cur) => (cur && cur.amount >= saved.amount ? cur : saved));
  }, [handle, demo]);

  useDonationStream(handle, (e) => beatRef.current(e.from, e.amount), demo);

  // Demo: escalating beats every ~30s so the coronation demonstrably fires (regular startDemo
  // donations, running via useDonationStream above, also break it naturally).
  useEffect(() => {
    if (!demo) return;
    const t = setInterval(() => {
      const base = recRef.current?.amount ?? 25;
      const name = RECORD_DEMO_NAMES[Math.floor(Math.random() * RECORD_DEMO_NAMES.length)];
      beatRef.current(name, base + 5 + Math.floor(Math.random() * 46));
    }, 30_000);
    return () => clearInterval(t);
  }, [demo]);

  // Drop the outgoing holder line once its 250ms flip-out has played (one hidden node max, briefly).
  useEffect(() => {
    if (!prev) return;
    const t = setTimeout(() => setPrev(null), 450);
    return () => clearTimeout(t);
  }, [prev]);

  const shownAmt = useCountUp(rec?.amount ?? 0, 700);

  // No record yet (real mode before the first donation): the spec defines no empty frame and an
  // empty "record" is a hollow claim — keep the stage clear until someone sets one.
  if (!rec) return <div className={`${styles.stage} ${styles.stageLeft}`} />;

  return (
    <div className={`${styles.stage} ${styles.stageLeft}`}>
      <div className={styles.record}>
        {ceremony > 0 && <span key={`g${ceremony}`} className={styles.recordGlow} />}
        <div className={styles.recordHead}>Stream record</div>
        <div className={styles.recordHolder}>
          {prev && (
            <div className={`${styles.recordLine} ${styles.lineOut}`}>
              <Mono name={prev.from} size={22} />
              <CheerMark className={styles.recordCheer} />
              <span className={styles.recordName}>{prev.from}</span>
            </div>
          )}
          <div key={`l${ceremony}`} className={ceremony > 0 ? `${styles.recordLine} ${styles.lineIn}` : styles.recordLine}>
            <Mono name={rec.from} size={22} />
            <CheerMark className={styles.recordCheer} />
            <span className={styles.recordName}>{rec.from}</span>
          </div>
        </div>
        <div className={styles.recordAmtWrap}>
          <div className={`${styles.recordAmt} num`}>${Math.round(shownAmt)}</div>
          <span key={`u${ceremony}`} className={ceremony > 0 ? `${styles.recordRule} ${styles.ruleDraw}` : styles.recordRule} />
        </div>
        <div className={styles.recordFoot}>beat it</div>
      </div>
    </div>
  );
}

// ---- Train: a combo counter alive only while donations keep coming; the fuse is the timer. ----

const TRAIN_WINDOW_MS = 5 * 60_000; // rolling window: the train dies 5 min after the last donation
// DEVIATION from the 5-minute window in demo: the spec's demo arc ("~45s silence so the preview
// shows grow, drain, expire, restart") can only expire if the demo fuse is shorter than the silence.
const TRAIN_DEMO_WINDOW_MS = 40_000;

interface TrainState {
  count: number;
  total: number;
  lastTs: number;
}

export function TrainOverlay({ handle, demo }: Common) {
  const windowMs = demo ? TRAIN_DEMO_WINDOW_MS : TRAIN_WINDOW_MS;
  const [train, setTrain] = useState<TrainState | null>(null);
  const [dying, setDying] = useState(false);

  const ingest = (amount: number) => {
    const now = Date.now();
    setDying(false); // a donation mid-fade revives the train
    setTrain((t) =>
      !t || now - t.lastTs > windowMs
        ? { count: 1, total: amount, lastTs: now }
        : { count: t.count + 1, total: t.total + amount, lastTs: now },
    );
  };
  const ingestRef = useRef(ingest);
  ingestRef.current = ingest;

  // Real donations only here — demo runs its own burst loop below. startDemo's steady 4.5s cadence
  // would keep the fuse pinned near full, so the expire/restart arc would never show in a preview.
  useDonationStream(handle, (e) => ingestRef.current(e.amount), false);

  // Demo bursts: 3–5 donations ~8s apart, then ~45s of silence — the full grow→drain→expire arc.
  // Component-state only: never publishes to the BroadcastChannel.
  useEffect(() => {
    if (!demo) return;
    let timer = 0;
    let left = 0;
    const step = () => {
      if (left <= 0) left = 3 + Math.floor(Math.random() * 3);
      ingestRef.current(5 + Math.floor(Math.random() * 21));
      left -= 1;
      timer = window.setTimeout(step, left > 0 ? 7000 + Math.random() * 2000 : 45_000);
    };
    timer = window.setTimeout(step, 1000);
    return () => window.clearTimeout(timer);
  }, [demo]);

  // Expiry: when the fuse runs dry, fade 500ms, then unmount until the next train.
  useEffect(() => {
    if (!train || dying) return;
    const t = setTimeout(() => setDying(true), Math.max(0, train.lastTs + windowMs - Date.now()));
    return () => clearTimeout(t);
  }, [train, dying, windowMs]);
  useEffect(() => {
    if (!dying) return;
    const t = setTimeout(() => {
      setTrain(null);
      setDying(false);
    }, 500);
    return () => clearTimeout(t);
  }, [dying]);

  const pop = useChangeNonce(train?.count ?? 0); // keys the multiplier's one-shot pop

  return (
    <div className={`${styles.stage} ${styles.stageTopRight}`}>
      {train && (
        <div
          className={`${styles.train}${train.count >= 5 ? ` ${styles.trainMax}` : ""}${dying ? ` ${styles.trainDying}` : ""}`}
        >
          <div className={styles.trainHead}>
            <span className={styles.trainLabel}>Train</span>
            <span key={pop} className={styles.trainMult}>
              ×{train.count}
            </span>
          </div>
          <div className={`${styles.trainTotal} num`}>{usd(train.total)}</div>
          <div className={styles.trainFuse}>
            {/* keyed by lastTs: every donation remounts the fill → refill to 100% + fresh drain */}
            <span key={train.lastTs} className={styles.trainFuseFill} style={{ animationDuration: `${windowMs}ms` }} />
          </div>
        </div>
      )}
    </div>
  );
}
