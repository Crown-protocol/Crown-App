import type { GameId } from "@/lib/data/games";
import styles from "./GameCover.module.css";

// Poster art for each mini-game — SVG, not image files: stays on the design tokens (one purple
// accent on a dark field), scales to any card size, no network request. Each poster is ONE bold,
// clean motif centred high on a 300×400 card (caption scrim owns the bottom ~90px), lifted off the
// field by a single accent glow. Neutrals separate by value, never by hue (design charter §II.1).
const CX = 150;
const CY = 168;

// 0° = top, clockwise (same convention as RouletteWheel).
function slicePath(startDeg: number, endDeg: number, r: number): string {
  const pt = (deg: number) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return [r * Math.cos(a), r * Math.sin(a)] as const;
  };
  const [x1, y1] = pt(startDeg);
  const [x2, y2] = pt(endDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M0 0 L${x1.toFixed(1)} ${y1.toFixed(1)} A${r} ${r} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z`;
}

const NEUTRAL = "#242233"; // the one secondary fill — everything non-accent
const NEUTRAL_HI = "#2E2C40";

function Defs({ id }: { id: string }) {
  return (
    <defs>
      {/* deep field, a touch lighter at top so the motif has air above it */}
      <linearGradient id={`bg-${id}`} x1="0.15" y1="0" x2="0.7" y2="1">
        <stop offset="0%" stopColor="#232134" />
        <stop offset="52%" stopColor="#17161F" />
        <stop offset="100%" stopColor="#0C0B11" />
      </linearGradient>
      {/* the single accent glow that lifts the motif off the field */}
      <radialGradient id={`glow-${id}`} cx="50%" cy="42%" r="58%">
        <stop offset="0%" stopColor="#8B7CF6" stopOpacity="0.40" />
        <stop offset="55%" stopColor="#8B7CF6" stopOpacity="0.09" />
        <stop offset="100%" stopColor="#8B7CF6" stopOpacity="0" />
      </radialGradient>
      {/* the house accent ramp — bright purple, top-lit (same family as the buttons) */}
      <linearGradient id={`ramp-${id}`} x1="0" y1="0" x2="0.25" y2="1">
        <stop offset="0%" stopColor="#C3B6FF" />
        <stop offset="48%" stopColor="#8B7CF6" />
        <stop offset="100%" stopColor="#6A57D6" />
      </linearGradient>
      {/* light-cored orb for round hero shapes (wheel slice, bullseye) */}
      <radialGradient id={`orb-${id}`} cx="40%" cy="32%" r="78%">
        <stop offset="0%" stopColor="#F2EFFF" />
        <stop offset="42%" stopColor="#A697FB" />
        <stop offset="100%" stopColor="#6A57D6" />
      </radialGradient>
      {/* a clean top-left highlight sweeping the accent */}
      <linearGradient id={`sheen-${id}`} x1="0" y1="0" x2="0.9" y2="1">
        <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.42" />
        <stop offset="42%" stopColor="#FFFFFF" stopOpacity="0" />
      </linearGradient>
      {/* soft halo behind the accent so it reads as glowing, not painted on */}
      <filter id={`halo-${id}`} x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation="12" />
      </filter>
      {/* crisp drop shadow: the motif floats above the field */}
      <filter id={`sh-${id}`} x="-40%" y="-40%" width="180%" height="180%">
        <feDropShadow dx="0" dy="9" stdDeviation="13" floodColor="#000000" floodOpacity="0.5" />
      </filter>
    </defs>
  );
}

// A framed field with the accent glow — shared opening for every poster.
function Field({ id }: { id: string }) {
  return (
    <>
      <rect width="300" height="400" fill={`url(#bg-${id})`} />
      <rect width="300" height="400" fill={`url(#glow-${id})`} />
    </>
  );
}

export function GameCover({ id }: { id: GameId }) {
  const common = {
    viewBox: "0 0 300 400",
    preserveAspectRatio: "xMidYMid slice",
    className: styles.svg,
    "aria-hidden": true as const,
  };

  if (id === "roulette") {
    // A clean six-segment wheel, rotated so a segment centres under the pointer. One segment carries
    // the accent (the pick); the rest are one calm neutral, split by thin light dividers.
    const R = 116;
    const segs = [0, 1, 2, 3, 4, 5];
    return (
      <svg {...common}>
        <Defs id="rl" />
        <Field id="rl" />
        {/* halo under the wheel */}
        <circle cx={CX} cy={CY} r={R * 0.7} fill="#8B7CF6" opacity="0.16" filter="url(#halo-rl)" />
        <g transform={`translate(${CX} ${CY}) rotate(-30)`} filter="url(#sh-rl)">
          {/* disc body */}
          <circle r={R} fill={NEUTRAL} />
          {segs.map((i) => (
            <path
              key={i}
              d={slicePath(i * 60, i * 60 + 60, R)}
              fill={i === 0 ? "url(#orb-rl)" : i % 2 === 0 ? NEUTRAL : NEUTRAL_HI}
              stroke="#0E0D13"
              strokeWidth="1.5"
            />
          ))}
          {/* sheen on the accent segment */}
          <path d={slicePath(4, 56, R)} fill="url(#sheen-rl)" opacity="0.8" />
          {/* rim: hairline + faint accent ring */}
          <circle r={R} fill="none" stroke="rgba(235,233,244,.26)" strokeWidth="2" />
          <circle r={R + 4} fill="none" stroke="#8B7CF6" strokeWidth="2" opacity="0.35" />
          {/* hub */}
          <circle r="19" fill="#100F16" stroke="rgba(235,233,244,.28)" strokeWidth="2" />
          <circle r="7" fill="url(#orb-rl)" />
        </g>
        {/* pointer — white, dark seam so it survives on the light segment */}
        <path d={`M${CX} ${CY - R + 2} L${CX - 13} ${CY - R - 26} Q${CX} ${CY - R - 33} ${CX + 13} ${CY - R - 26} Z`} fill="#0E0D13" opacity="0.85" />
        <path d={`M${CX} ${CY - R - 2} L${CX - 10} ${CY - R - 24} Q${CX} ${CY - R - 29} ${CX + 10} ${CY - R - 24} Z`} fill="#F1EFF7" />
      </svg>
    );
  }

  if (id === "fundraiser") {
    // A big crown vessel filling bottom-up toward the goal line — a glowing trophy, not a flat icon.
    const crown = "M4 44 L4 13 L17 25 L26 5 L35 25 L48 13 L48 44 Z";
    const top = 5;
    const bottom = 44;
    const fill = (bottom - top) * 0.66; // filled height
    const S = 4.3;
    const ox = CX - (26 * S); // centre the 52-wide crown
    const oy = CY - 24 * S;
    const goalY = oy + top * S;
    return (
      <svg {...common}>
        <Defs id="fr" />
        <Field id="fr" />
        {/* accent pool the trophy sits in */}
        <ellipse cx={CX} cy={oy + bottom * S + 10} rx="96" ry="20" fill="#8B7CF6" opacity="0.20" filter="url(#halo-fr)" />
        {/* goal line at the crown's tips */}
        <line x1={CX - 118} y1={goalY} x2={CX + 118} y2={goalY} stroke="rgba(235,233,244,.3)" strokeWidth="2" strokeDasharray="7 7" />
        <text x={CX + 122} y={goalY + 4} fill="rgba(235,233,244,.4)" fontSize="13" fontFamily="system-ui, sans-serif" fontWeight="600">
          goal
        </text>
        <g transform={`translate(${ox} ${oy}) scale(${S})`} filter="url(#sh-fr)">
          <clipPath id="crown-clip-fr">
            <path d={crown} />
          </clipPath>
          {/* empty vessel */}
          <path d={crown} fill="#191824" />
          {/* fill */}
          <rect x="0" y={bottom - fill} width="52" height={fill} clipPath="url(#crown-clip-fr)" fill="url(#ramp-fr)" />
          {/* waterline highlight */}
          <rect x="0" y={bottom - fill} width="52" height="1.4" clipPath="url(#crown-clip-fr)" fill="#EDEAFE" opacity="0.7" />
          {/* sheen on the filled part */}
          <rect x="0" y={bottom - fill} width="24" height={fill} clipPath="url(#crown-clip-fr)" fill="url(#sheen-fr)" />
          {/* outline */}
          <path d={crown} fill="none" stroke="rgba(235,233,244,.6)" strokeWidth="1.1" strokeLinejoin="round" />
        </g>
      </svg>
    );
  }

  if (id === "auction") {
    // Lot bars climbing left→right, the leader carrying the accent, a gavel mid-strike above it.
    const bars = [
      { x: 44, h: 66 },
      { x: 96, h: 100 },
      { x: 148, h: 148 },
      { x: 200, h: 200 },
    ];
    const base = 272;
    const W = 40;
    return (
      <svg {...common}>
        <Defs id="au" />
        <Field id="au" />
        {/* halo behind the leader */}
        <circle cx={bars[3].x + W / 2} cy={base - bars[3].h + 40} r="60" fill="#8B7CF6" opacity="0.2" filter="url(#halo-au)" />
        {/* baseline */}
        <line x1="30" y1={base + 1} x2="270" y2={base + 1} stroke="rgba(235,233,244,.16)" strokeWidth="2" />
        <g filter="url(#sh-au)">
          {bars.map((b, i) => {
            const lead = i === bars.length - 1;
            return (
              <g key={i}>
                <rect x={b.x} y={base - b.h} width={W} height={b.h} rx="9" fill={lead ? "url(#ramp-au)" : NEUTRAL} />
                {lead && <rect x={b.x} y={base - b.h} width="17" height={b.h} rx="9" fill="url(#sheen-au)" />}
              </g>
            );
          })}
        </g>
        {/* gavel, mid-strike above the leading lot */}
        <g transform={`translate(${bars[3].x + W / 2 - 6} ${base - bars[3].h - 30}) rotate(38)`} filter="url(#sh-au)">
          {/* head */}
          <rect x="-30" y="-13" width="60" height="26" rx="8" fill="#EFEDF7" />
          <rect x="-30" y="-13" width="60" height="11" rx="8" fill="#FFFFFF" opacity="0.5" />
          {/* bands */}
          <rect x="-19" y="-13" width="4" height="26" fill="#C7C2D8" opacity="0.8" />
          <rect x="15" y="-13" width="4" height="26" fill="#C7C2D8" opacity="0.8" />
          {/* handle */}
          <rect x="-5" y="12" width="10" height="52" rx="5" fill="#DDD9EA" />
        </g>
        {/* strike sparks on the leader's top */}
        <g stroke="#C3B6FF" strokeWidth="3" strokeLinecap="round" opacity="0.9">
          <path d={`M${bars[3].x - 4} ${base - bars[3].h - 6} l-9 -8`} />
          <path d={`M${bars[3].x + W + 4} ${base - bars[3].h - 6} l9 -8`} />
          <path d={`M${bars[3].x + W / 2} ${base - bars[3].h - 12} l0 -11`} />
        </g>
      </svg>
    );
  }

  // task — a target with a landed dart: the dare a viewer sets, and the money riding on the hit.
  const RINGS = [
    { r: 116, w: 22, fill: NEUTRAL },
    { r: 88, w: 22, fill: NEUTRAL_HI },
    { r: 60, w: 22, fill: "#3A3552" },
  ];
  return (
    <svg {...common}>
      <Defs id="tk" />
      <Field id="tk" />
      <circle cx={CX} cy={CY} r="70" fill="#8B7CF6" opacity="0.18" filter="url(#halo-tk)" />
      <g transform={`translate(${CX} ${CY})`} filter="url(#sh-tk)">
        {RINGS.map((ring) => (
          <circle key={ring.r} r={ring.r} fill="none" stroke={ring.fill} strokeWidth={ring.w} />
        ))}
        {/* faint separators between rings */}
        {RINGS.map((ring) => (
          <circle key={`s${ring.r}`} r={ring.r + ring.w / 2} fill="none" stroke="#0E0D13" strokeWidth="1.5" />
        ))}
        {/* bullseye — a glowing accent orb */}
        <circle r="33" fill="url(#orb-tk)" />
        <circle r="33" fill="url(#sheen-tk)" />
        <circle r="33" fill="none" stroke="rgba(255,255,255,.35)" strokeWidth="1.5" />
      </g>
      {/* the dart, landed just off-centre */}
      <g transform={`translate(${CX + 26} ${CY + 26}) rotate(-42)`} filter="url(#sh-tk)">
        <path d="M0 0 L-6 14 L6 14 Z" fill="#F1EFF7" />
        <rect x="-2.5" y="14" width="5" height="74" rx="2.5" fill="#E8E5F2" />
        <path d="M-2.5 78 L-15 94 L-2.5 96 Z" fill="#F1EFF7" opacity="0.95" />
        <path d="M2.5 78 L15 94 L2.5 96 Z" fill="#A6A2B4" opacity="0.9" />
      </g>
    </svg>
  );
}
