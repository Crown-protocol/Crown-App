import styles from "./HeroPhones.module.css";

// Hero-mockup-only fundraiser figure. The shared FundraiserFill (real fundraiser page, overlays, OBS)
// is deliberately left untouched. The shared one fills with the brand mark's purple→near-white
// gradient, which in a small hero mockup reads as an *uneven* wash (bright white at the bottom, faint
// at the top) rather than a clean "72% collected". This variant fills with a single flat accent — an
// even level rising to a crisp waterline, crown punched clean through — so the fill reads at a glance.
const HEX = "M24 1.5 44.5 13.25 44.5 34.75 24 46.5 3.5 34.75 3.5 13.25Z";
const HEX_INSET = "M24 5.6 40.9 15.3 40.9 32.7 24 42.4 7.1 32.7 7.1 15.3Z";
const CROWN = "M12.6 32.4 14.2 19.4 19.3 26.2 24 14.6 28.7 26.2 33.8 19.4 35.4 32.4C29.6 34.6 18.4 34.6 12.6 32.4Z";
const INK = "#100f16"; // the fundraiser screen background — the crown reads as a hole punched through
const LINE = "rgba(196,183,250,0.5)"; // faint accent outline for the empty (unfilled) part

export function HeroFundraiserFill({ pct, size = 154 }: { pct: number; size?: number }) {
  const p = Math.min(1, Math.max(0, pct));
  // Reveal the bottom `p` of the solid-fill layer by clipping away the top (1 - p).
  const clip = `inset(${((1 - p) * 100).toFixed(2)}% 0 0 0)`;
  return (
    <div className={styles.frFill} style={{ width: size, height: size }} aria-hidden>
      {/* empty vessel: a clean faint outline */}
      <svg className={styles.frFillLayer} viewBox="0 0 48 48" fill="none">
        <path d={HEX_INSET} stroke={LINE} strokeWidth="1.4" strokeLinejoin="round" />
        <path d={CROWN} stroke={LINE} strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx="14.2" cy="17.6" r="1.7" stroke={LINE} strokeWidth="1.1" />
        <circle cx="24" cy="12.8" r="1.9" stroke={LINE} strokeWidth="1.1" />
        <circle cx="33.8" cy="17.6" r="1.7" stroke={LINE} strokeWidth="1.1" />
      </svg>
      {/* collected level: one flat accent fill (no gradient wash), crown punched out in ink */}
      <svg className={styles.frFillLayer} style={{ clipPath: clip }} viewBox="0 0 48 48">
        <path d={HEX} className={styles.frHex} />
        <path d={HEX_INSET} fill="none" stroke={INK} strokeWidth="1.4" strokeLinejoin="round" />
        <path d={CROWN} fill={INK} />
        <circle cx="14.2" cy="17.6" r="2.4" fill={INK} />
        <circle cx="24" cy="12.8" r="2.7" fill={INK} />
        <circle cx="33.8" cy="17.6" r="2.4" fill={INK} />
      </svg>
      <span className={styles.frWaterline} style={{ bottom: `${(p * 100).toFixed(2)}%` }} />
    </div>
  );
}
