"use client";

import { useEffect, useRef, useState } from "react";
import { DemoFrame } from "@/components/games/GameDemo";
import styles from "@/components/games/GameDemo.module.css";

// The roulette demo: Launch → set up a topic + the picks viewers backed → spin a real weighted wheel.
// The wheel is the one splash of colour; odds are each pick's share of the pot (front.md §5).
const WEDGE = ["#C0B7FA", "#8B82C4", "#565270", "#A79FE0", "#6E6A88", "#403E52"];
const PRESETS: Record<string, { name: string; amt: number }[]> = {
  Games: [{ name: "Warcraft III", amt: 992 }, { name: "Fortnite", amt: 496 }, { name: "Dota 2", amt: 112 }],
  Films: [{ name: "Dune", amt: 640 }, { name: "Interstellar", amt: 410 }, { name: "The Matrix", amt: 180 }],
  Music: [{ name: "Bohemian Rhapsody", amt: 560 }, { name: "One More Time", amt: 320 }, { name: "Take On Me", amt: 140 }],
  Food: [{ name: "Ramen challenge", amt: 520 }, { name: "Spiciest wings", amt: 300 }, { name: "Mystery box", amt: 150 }],
};
const fmt = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

export function RouletteDemo() {
  const [step, setStep] = useState(0);
  const [topic, setTopic] = useState("Games");
  const [picks, setPicks] = useState(PRESETS.Games.map((p) => ({ ...p })));
  const [name, setName] = useState("");
  const [amt, setAmt] = useState("");
  const [winner, setWinner] = useState(-1);
  const [result, setResult] = useState<ReactResult>({ text: "Spin when you're ready." });
  const [spinning, setSpinning] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const angleRef = useRef(0);

  const total = picks.reduce((s, p) => s + p.amt, 0);

  function draw() {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const S = 500, cx = 250, cy = 250, rad = 228, t = total || 1;
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angleRef.current);
    let a = -Math.PI / 2;
    picks.forEach((p, i) => {
      const slice = (p.amt / t) * Math.PI * 2;
      const isWin = i === winner, dim = winner >= 0 && !isWin;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, rad, a, a + slice);
      ctx.closePath();
      ctx.fillStyle = WEDGE[i % WEDGE.length];
      ctx.globalAlpha = dim ? 0.28 : 1;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "#17161c";
      ctx.lineWidth = 3;
      ctx.stroke();
      if (isWin) {
        ctx.save();
        ctx.strokeStyle = "#EFEAFF";
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.restore();
      }
      if (slice > 0.26) {
        ctx.save();
        ctx.rotate(a + slice / 2);
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        const light = ["#C0B7FA", "#A79FE0"].includes(WEDGE[i % WEDGE.length]);
        ctx.fillStyle = light ? "#141019" : "#F1EFF7";
        ctx.globalAlpha = dim ? 0.5 : 1;
        ctx.font = "600 20px -apple-system, Segoe UI, Roboto, sans-serif";
        const nm = p.name.length > 13 ? p.name.slice(0, 12) + "…" : p.name;
        ctx.fillText(nm, rad - 18, 0);
        ctx.restore();
      }
      a += slice;
    });
    ctx.restore();
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(235,233,244,.16)";
    ctx.lineWidth = 2;
    ctx.stroke();
    for (let k = 0; k < 48; k++) {
      const ang = (k / 48) * Math.PI * 2, r0 = rad + 3, r1 = rad + (k % 4 === 0 ? 9 : 6);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
      ctx.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
      ctx.strokeStyle = "rgba(235,233,244,.12)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  // redraw on any state that affects the wheel
  useEffect(() => {
    if (step === 2) draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, picks, winner]);

  function addPick() {
    const n = name.trim();
    if (!n) return;
    const a = Math.max(1, Math.round(Number(amt)) || Math.round(40 + Math.random() * 300));
    setPicks((p) => [...p, { name: n, amt: a }]);
    setName("");
    setAmt("");
  }

  function pickTopic(t: string) {
    setTopic(t);
    setPicks(PRESETS[t].map((p) => ({ ...p })));
  }

  function toRun() {
    if (picks.length < 2) return;
    setWinner(-1);
    setResult({ text: "Spin when you're ready." });
    setStep(2);
  }

  function spin() {
    if (spinning || picks.length < 2) return;
    setSpinning(true);
    setWinner(-1);
    setResult({ text: "Spinning…" });
    const t = total;
    let r = Math.random() * t, idx = 0, acc = 0;
    for (let i = 0; i < picks.length; i++) {
      acc += picks[i].amt;
      if (r <= acc) { idx = i; break; }
    }
    let a = 0;
    for (let i = 0; i < idx; i++) a += picks[i].amt / t;
    const centre = (a + picks[idx].amt / t / 2) * Math.PI * 2;
    const to = Math.PI * 2 * 6 - centre, from = angleRef.current % (Math.PI * 2), dur = 3600, t0 = performance.now();
    const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const finish = () => {
      angleRef.current = to % (Math.PI * 2);
      setWinner(idx);
      setSpinning(false);
      setResult({ win: picks[idx].name, tail: ` wins — you play it. ${Math.round((picks[idx].amt / t) * 100)}% odds.` });
    };
    if (reduce) { angleRef.current = to; finish(); return; }
    const frame = (now: number) => {
      const k = Math.min(1, (now - t0) / dur);
      angleRef.current = from + (to - from) * (1 - Math.pow(1 - k, 4.2));
      draw();
      if (k < 1) requestAnimationFrame(frame);
      else finish();
    };
    requestAnimationFrame(frame);
  }

  return (
    <DemoFrame step={step}>
      {step === 0 && (
        <div className={styles.screen}>
          <div className={styles.intro}>
            <span className={styles.orb} aria-hidden>
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="12" r="9" /><path d="M12 7.5v4.5l3 1.8" /></svg>
            </span>
            <h3>See a round play out</h3>
            <p>Set it up like a streamer would, then spin — weighted by the pot, just like the real thing.</p>
            <button className={styles.primary} type="button" style={{ marginTop: 8 }} onClick={() => setStep(1)}>
              Launch the demo
            </button>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className={styles.screen}>
          <div className={styles.stitle}>Set up your round</div>
          <p className={styles.ssub}>Pick a topic, then the picks your viewers backed.</p>
          <div className={styles.field}>
            <label>Topic</label>
            <div className={styles.segrow}>
              {Object.keys(PRESETS).map((t) => (
                <button key={t} type="button" className={`${styles.seg} ${topic === t ? styles.on : ""}`} onClick={() => pickTopic(t)}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.field} style={{ marginBottom: 8 }}>
            <label>Picks on the wheel</label>
            <div className={styles.rows}>
              {picks.map((p, i) => (
                <div className={styles.row} key={i}>
                  <span className={styles.rowName}>{p.name}</span>
                  <span className={styles.rowAmt}>{fmt(p.amt)}</span>
                  <button className={styles.rm} type="button" aria-label="Remove" onClick={() => setPicks((x) => x.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <div className={styles.addRow}>
              <input type="text" placeholder="Add a pick" maxLength={22} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addPick()} aria-label="Pick name" />
              <input className={styles.amt} type="number" min={1} placeholder="$" value={amt} onChange={(e) => setAmt(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addPick()} aria-label="Amount" />
              <button className={styles.add} type="button" aria-label="Add pick" onClick={addPick}>+</button>
            </div>
          </div>
          <div className={styles.sfoot}>
            <button className={styles.lnk} type="button" onClick={() => setStep(0)}>← Back</button>
            <button className={styles.primary} type="button" onClick={toRun}>Open the round →</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className={styles.screen}>
          <div className={styles.stage}>
            <span className={styles.pointer} aria-hidden>
              <svg width="20" height="16" viewBox="0 0 20 16"><path d="M10 16L1 2a2 2 0 0 1 1.7-3h14.6A2 2 0 0 1 19 2Z" fill="#C0B7FA" /></svg>
            </span>
            <canvas ref={canvasRef} width={500} height={500} />
            <div className={styles.hub}>
              <span className={styles.pot}>{fmt(total)}</span>
              <span className={styles.potl}>in the pot</span>
            </div>
          </div>
          <div className={styles.result}>
            {result.win ? (<><span className={styles.win}>{result.win}</span>{result.tail}</>) : result.text}
          </div>
          <div className={styles.legend}>
            {picks.map((p, i) => (
              <div key={i} className={`${styles.lrow} ${winner >= 0 && i !== winner ? styles.dim : ""}`}>
                <span className={styles.sw} style={{ background: WEDGE[i % WEDGE.length] }} />
                <span className={styles.lname}>{p.name}<span className={styles.lodds}>{Math.round((p.amt / (total || 1)) * 100)}%</span></span>
                <span className={styles.lamt}>{fmt(p.amt)}</span>
              </div>
            ))}
          </div>
          <div className={styles.rfoot}>
            <button className={styles.ghost} type="button" onClick={() => setStep(1)}>Edit</button>
            <button className={styles.primary} type="button" disabled={spinning || picks.length < 2} onClick={spin}>Spin the wheel</button>
          </div>
          <p className={styles.railNote}>Real overlays on your stream react to the round live.</p>
        </div>
      )}
    </DemoFrame>
  );
}

type ReactResult = { text?: string; win?: string; tail?: string };
