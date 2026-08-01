"use client";

import { useRef, useState, type ReactNode } from "react";

export function money(n: number) {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}
export function shortMoney(n: number) {
  return n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${n}`;
}

// A handful of evenly spaced labels from a longer series — what a chart's x-axis shows
// (the tooltip on hover shows every point; the axis only needs the landmarks).
export function axisTicks(labels: string[], count = 4) {
  if (labels.length <= count) return labels;
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(labels[Math.round((i / (count - 1)) * (labels.length - 1))]);
  }
  return out;
}

export function StatTile({ k, v, s }: { k: string; v: string; s?: string }) {
  return (
    <div className="stat">
      <div className="k">{k}</div>
      <div className="v num">{v}</div>
      {s ? <div className="s">{s}</div> : null}
    </div>
  );
}

export type Bar = { label: string; value: number; icon?: ReactNode; display?: string };

// Magnitude bars: neutral track, value in white, length = comparison.
export function BarList({ bars, unit }: { bars: Bar[]; unit?: "money" | "count" }) {
  const max = Math.max(...bars.map((b) => b.value), 1);
  return (
    <div className="barlist">
      {bars.map((b) => (
        <div className="barrow" key={b.label} title={`${b.label}: ${b.display ?? b.value}`}>
          <span className="bl">
            {b.icon}
            {b.label}
          </span>
          <div className="bartrack">
            <div className="barfill" style={{ width: `${Math.max((b.value / max) * 100, b.value ? 3 : 0)}%` }} />
          </div>
          <span className="bv num">{b.display ?? (unit === "money" ? shortMoney(b.value) : b.value)}</span>
        </div>
      ))}
    </div>
  );
}

// One big growth chart — bars or line (toggle lives in the caller), always money-white
// per the charter. Hover shows a crosshair (line view) or dims other bars (bar view),
// plus a tooltip with the exact value + date for that point.
export function GrowthChart({
  data,
  labels,
  format = (v) => String(Math.round(v)),
  view,
  color = "var(--text-1)",
}: {
  data: number[];
  labels: string[];
  format?: (v: number) => string;
  view: "bars" | "line";
  color?: string;
}) {
  const max = Math.max(...data, 1);
  const W = 100;
  const H = 100;
  const top = 4;

  const ref = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState<number | null>(null);
  function onMove(e: React.MouseEvent) {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || !rect.width) return;
    const x = (e.clientX - rect.left) / rect.width;
    setIdx(Math.max(0, Math.min(data.length - 1, Math.round(x * (data.length - 1)))));
  }

  const gap = 0.8;
  const bw = (W - gap * (data.length - 1)) / data.length;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * W, H - (v / max) * (H - top)] as const);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(" ");
  const area = `${line} L${W} ${H} L0 ${H} Z`;

  const tipLeft = view === "bars" ? ((idx ?? 0) + 0.5) / data.length : (idx ?? 0) / (data.length - 1);

  return (
    <div className="mini-chart big" ref={ref} onMouseMove={onMove} onMouseLeave={() => setIdx(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="growth">
        {view === "bars" ? (
          <>
            <defs>
              {/* vertical accent→white gradient (top purple, bottom white) */}
              <linearGradient id="growth-bars" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" />
                <stop offset="100%" stopColor="#ffffff" />
              </linearGradient>
            </defs>
            {data.map((v, i) => {
              const h = Math.max((v / max) * (H - top), v ? 2 : 1);
              return <rect key={i} x={i * (bw + gap)} y={H - h} width={bw} height={h} fill="url(#growth-bars)" opacity={idx === null || idx === i ? 1 : 0.4} rx={0.5} />;
            })}
          </>
        ) : (
          <>
            <defs>
              <linearGradient id="growth-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
                <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={area} fill="url(#growth-fill)" />
            <path d={line} fill="none" stroke={color} strokeWidth={1.6} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
            {idx !== null && <line x1={pts[idx][0]} y1={0} x2={pts[idx][0]} y2={H} stroke="var(--line-strong)" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
          </>
        )}
      </svg>
      {view === "line" && idx !== null && <span className="mini-dot" style={{ left: `${pts[idx][0]}%`, top: `${pts[idx][1]}%`, background: color }} />}
      {idx !== null && (
        <div className="mini-tip" style={{ left: `${tipLeft * 100}%` }}>
          <b className="num">{format(data[idx])}</b>
          <span>{labels[idx]}</span>
        </div>
      )}
    </div>
  );
}

// A <th> whose label is a button — click to sort by this column, click again to flip direction.
export function SortHeader({
  label,
  active,
  dir,
  onClick,
  align,
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
  align?: "r";
}) {
  return (
    // aria-sort belongs on the column header itself, not the button inside it.
    <th className={align} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className="sort-th" onClick={onClick}>
        {label}
        <span className={`sort-arrow${active ? " active" : ""}`}>{active ? (dir === "asc" ? "▲" : "▼") : "↕"}</span>
      </button>
    </th>
  );
}

export function StatusPill({ tone, children }: { tone: "wait" | "attn" | "ok" | "bad" | "neutral"; children: ReactNode }) {
  return (
    <span className={`pill ${tone}`}>
      <span className="dot" />
      {children}
    </span>
  );
}
