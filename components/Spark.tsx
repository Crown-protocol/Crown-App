"use client";

import { useId } from "react";

// Mini chart of receipts over time. Neutral by design — the accent is rationed site-wide
// (sparingly, and only where it means something), and a wall of purple sparklines was spending it on decoration.
// Stretches to the parent's width (preserveAspectRatio="none").
export function Spark({ data, className }: { data: number[]; className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const w = 100;
  const h = 32;
  const pad = 3;

  if (!data.length) return <div className={className} aria-hidden />;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const step = data.length > 1 ? w / (data.length - 1) : w;

  const pts = data.map((v, i) => {
    const x = i * step;
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    return [x, y] as const;
  });

  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L${w} ${h} L0 ${h} Z`;

  return (
    <svg className={className} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={`sg-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#F1EFF7" stopOpacity="0.14" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#sg-${id})`} />
      <path d={line} fill="none" stroke="rgba(241, 239, 247, 0.55)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
