"use client";

import { useRef, useState } from "react";
import type { ReactNode, SVGProps } from "react";

type View = "bar" | "line";

export function BarsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden {...props}>
      <path d="M5 19V10M12 19V5M19 19v-6" />
    </svg>
  );
}
export function LineIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <path d="M4 16.5 9 10l4 3 7-9.5" />
    </svg>
  );
}

function money(v: number) {
  return `$${Math.round(v).toLocaleString("en-US")}`;
}

// Line view — an area chart in the accent, drawn like the reference: the stroke and the fill both
// ride a vertical gradient that's brightest at the top and fades toward the bottom, over faint
// horizontal gridlines, with a single dot on the peak (the all-time high) — no dot on the end of the
// line. hover (null = none) draws a crosshair + dot at that index.
const GRID_LINES = 6;

function LineView({
  days,
  max,
  peakIndex,
  peakLabel,
  hover,
}: {
  days: number[];
  max: number;
  peakIndex: number;
  peakLabel: string;
  hover: number | null;
}) {
  const W = 100;
  const H = 100;
  const top = 8; // top margin so the peak dot doesn't clip the edge
  const step = days.length > 1 ? W / (days.length - 1) : W;
  const pts = days.map((v, i) => [i * step, H - (v / max) * (H - top)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L${W} ${H} L0 ${H} Z`;
  const peak = peakIndex >= 0 ? pts[peakIndex] : null;
  const hp = hover !== null ? pts[hover] : null;

  return (
    <div style={{ paddingTop: 32 }}>
      <div style={{ height: 168, position: "relative" }}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: "100%", display: "block" }} aria-hidden>
          <defs>
            {/* the SAME ramp the bars use (--chart-grad: grad-top → white), so the two views read
                as one chart: peaks saturated purple, the baseline fading to white */}
            {/* the stroke gradient spans the PATH's own bbox, and the line lives low in the frame —
                so the purple has to hold most of the way down, or everything but the peak reads
                white. Purple until ~70%, white only at the very baseline: the bars' ramp, scaled. */}
            <linearGradient id="chart-line-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--grad-top)" stopOpacity="0.55" />
              <stop offset="70%" stopColor="var(--grad-top)" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="chart-line-stroke" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--grad-top)" />
              <stop offset="70%" stopColor="var(--grad-top)" />
              <stop offset="100%" stopColor="#ffffff" />
            </linearGradient>
          </defs>

          {/* horizontal gridlines */}
          {Array.from({ length: GRID_LINES + 1 }, (_, i) => {
            const y = (i / GRID_LINES) * H;
            return <line key={i} x1={0} y1={y} x2={W} y2={y} stroke="var(--line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />;
          })}

          <path d={area} fill="url(#chart-line-fill)" />
          <path
            d={line}
            fill="none"
            stroke="url(#chart-line-stroke)"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          {hp ? <line x1={hp[0]} y1={0} x2={hp[0]} y2={H} stroke="var(--line-strong)" strokeWidth={1} vectorEffect="non-scaling-stroke" /> : null}
        </svg>

        {/* dots sit in an overlay (percent-positioned) so they stay perfectly round despite the
            non-uniform SVG scaling that would otherwise squash an in-SVG <circle> into an ellipse */}
        {peak ? <span className="chart-dot" style={{ left: `${peak[0]}%`, top: `${peak[1]}%` }} /> : null}
        {hp ? <span className="chart-dot hot" style={{ left: `${hp[0]}%`, top: `${hp[1]}%` }} /> : null}

        {/* peak label only when not inspecting a point — the hover tooltip takes over otherwise */}
        {peak && hover === null ? (
          <span
            className="num"
            style={{
              position: "absolute",
              left: `${peak[0]}%`,
              top: `${peak[1]}%`,
              transform: "translate(-50%, calc(-100% - 12px))",
              fontSize: 14,
              color: "var(--text-2)",
              whiteSpace: "nowrap",
            }}
          >
            {peakLabel}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function Chart({
  title,
  days,
  peakValue,
  peakLabel,
  axis,
  labels,
  controls,
}: {
  title: string;
  days: number[];
  peakValue: number;
  peakLabel: string;
  axis: string[];
  labels?: string[]; // one date per point, for the hover tooltip; falls back to the value alone
  controls?: ReactNode; // optional filter row + headline stat, rendered between the header and the chart
}) {
  const [view, setView] = useState<View>("bar");
  const [hover, setHover] = useState<number | null>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const max = Math.max(peakValue, ...days) || 1;
  const peakIndex = days.indexOf(peakValue);

  // Map the pointer's x to the nearest point: bars sit in n slots (floor), the line has n-1 gaps (round).
  function onMove(e: React.MouseEvent) {
    const rect = areaRef.current?.getBoundingClientRect();
    if (!rect || !rect.width) return;
    const x = (e.clientX - rect.left) / rect.width;
    const i = view === "bar" ? Math.floor(x * days.length) : Math.round(x * (days.length - 1));
    setHover(Math.max(0, Math.min(days.length - 1, i)));
  }

  const tipLeft = hover === null ? 0 : view === "bar" ? ((hover + 0.5) / days.length) * 100 : days.length > 1 ? (hover / (days.length - 1)) * 100 : 50;

  return (
    <>
      <div className="main-head" style={{ marginBottom: 0 }}>
        <h2>{title}</h2>
        <div className="seg" role="group" aria-label="Chart view">
          <button
            type="button"
            className={view === "bar" ? "active" : ""}
            onClick={() => setView("bar")}
            aria-label="Bars"
            title="Bars"
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}
          >
            <BarsIcon />
          </button>
          <button
            type="button"
            className={view === "line" ? "active" : ""}
            onClick={() => setView("line")}
            aria-label="Line"
            title="Line"
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}
          >
            <LineIcon />
          </button>
        </div>
      </div>

      {controls}

      <div style={{ position: "relative" }} ref={areaRef} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {view === "bar" ? (
          <div className="chart" aria-hidden>
            {days.map((v, i) => {
              // match by index, not value — ties for the max would otherwise tag every equal bar
              const peak = i === peakIndex;
              return (
                <div className={`col${peak ? " peak" : ""}`} key={i} style={{ opacity: hover === null || hover === i ? 1 : 0.4 }}>
                  <div className="b" style={{ height: `${Math.max((v / max) * 100, v ? 4 : 2)}%` }} />
                  {/* peak label hides while inspecting a point — the tooltip below shows the exact figure */}
                  {peak && hover === null ? <span className="peak-tag num">{peakLabel}</span> : null}
                </div>
              );
            })}
          </div>
        ) : (
          <LineView days={days} max={max} peakIndex={peakIndex} peakLabel={peakLabel} hover={hover} />
        )}

        {hover !== null ? (
          <div className="mini-tip" style={{ left: `${tipLeft}%`, bottom: view === "bar" ? "calc(100% - 24px)" : "calc(100% - 20px)" }}>
            <b className="num">{money(days[hover])}</b>
            {labels?.[hover] ? <span>{labels[hover]}</span> : null}
          </div>
        ) : null}
      </div>

      <div className="axis num">
        {axis.map((a) => (
          <span key={a}>{a}</span>
        ))}
      </div>
    </>
  );
}
