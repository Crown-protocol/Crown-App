import type { CSSProperties } from "react";
import type { PageDesign, PageWidget, Profile } from "./types";

export const TASK_MAX = 200;

export const WIDGET_LABEL: Record<PageWidget["kind"], string> = {
  donate: "Donate form",
  socials: "Social icons",
};

export const DEFAULT_WIDGETS: PageWidget[] = [
  { kind: "donate", enabled: true },
  { kind: "socials", enabled: true },
];

export const DEFAULT_DONATE_PRESETS: number[] = [1, 5, 10];
export const MAX_DONATE_PRESETS = 6;

// The default backdrop for donation/game pages (and the builder). #100f16 — a deeper, slightly
// violet near-black (the hero fundraiser phone's colour the owner liked), not flat --bg-0.
export const DEFAULT_DESIGN: PageDesign = {
  background: { type: "color", value: "#100f16" },
};

// A readability scrim laid OVER a photo background (first background-image layer): top-heavy so the
// hero avatar/name/headline stays legible on a light photo (gym.jpg was near-invisible without it),
// fading down so most of the photo still shows through. Dark tuned to the page backdrop (#100f16).
const TEXT_SCRIM =
  "linear-gradient(180deg, rgba(13,12,19,0.74) 0%, rgba(13,12,19,0.36) 40%, rgba(13,12,19,0.20) 100%)";

// Neutral, on-charter swatches only (design charter II.1: one purple accent, no gold, no rainbow).
// These change the page BACKDROP, never the accent — the donate button stays Crown purple everywhere.
export const BACKGROUND_COLOR_PRESETS: { id: string; label: string; hex: string }[] = [
  { id: "black", label: "Black", hex: "#141318" },
  { id: "slate", label: "Slate", hex: "#1B1A21" },
  { id: "ink", label: "Ink", hex: "#101014" },
  { id: "steel", label: "Steel", hex: "#15181F" },
];

// Gradients are two colour STOPS the streamer can each pick freely (like the colour picker), so the
// value stored on the page is "from|to" (two hexes). The presets below are on-charter starting
// points; picking either swatch or a stop colour rewrites the value. gradientStops() also decodes
// the legacy preset ids ("dusk"/…) that older saved pages still carry, so nothing breaks.
// A gradient is two colour stops the streamer tunes: direction (angle), where they meet (pos,
// centred by default), and how sharp the meeting is (soft: 0 = a hard flag edge, 100 = a smooth
// fade). A preset can carry its own angle/pos/soft — e.g. Amber ships the owner's pick: a 135°
// gold→black sweep with a tight 39% blend.
export const GRAD_DEFAULTS = { angle: 160, pos: 50, soft: 100 } as const;

export const BACKGROUND_GRADIENT_PRESETS: {
  id: string;
  label: string;
  from: string;
  to: string;
  angle?: number;
  pos?: number;
  soft?: number;
}[] = [
  // The house gradient — the exact ramp the buttons and the crown fill use (docs/design.md
  // "Accent gradient"): grad-top → near-white, straight down, fully smooth.
  { id: "crown", label: "Crown", from: "#8B7CF6", to: "#F4F2FE", angle: 180, pos: 50, soft: 100 },
  { id: "dusk", label: "Dusk", from: "#1B1A21", to: "#141318" },
  { id: "amber", label: "Amber", from: "#E7C24A", to: "#0E0D11", angle: 135, pos: 50, soft: 39 }, // gold → black, the owner's sweep
  { id: "graphite", label: "Graphite", from: "#54545F", to: "#141318", angle: 135, pos: 50, soft: 39 }, // grey → dark, the same 135° sweep
  { id: "violet", label: "Violet", from: "#8B7CF6", to: "#15121F" }, // purple → dark
];

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

// ── Readability: is this backdrop light or dark? ──
// The page's text tokens are built for a dark field; a maker picking a light backdrop (the Crown
// gradient, a pale colour) must not wash the words out. backgroundInk() judges the backdrop's
// relative luminance and the pages flip to dark ink via the `.on-light` class (globals.css).
function hexLuminance(hex: string): number {
  const m = hex.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return 0; // unparseable → treat as dark, keep the default light text
  const n = parseInt(m[1], 16);
  const chan = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * chan((n >> 16) & 255) + 0.7152 * chan((n >> 8) & 255) + 0.0722 * chan(n & 255);
}

export function backgroundInk(design: PageDesign | undefined): "dark" | "light" {
  const bg = design?.background;
  if (!bg) return "dark";
  if (bg.type === "color") return hexLuminance(bg.value) > 0.45 ? "light" : "dark";
  if (bg.type === "gradient") {
    const { from, to } = gradientStops(bg.value);
    // The average of both stops: a mostly-light sweep flips the ink, a dark-anchored one doesn't.
    return (hexLuminance(from) + hexLuminance(to)) / 2 > 0.45 ? "light" : "dark";
  }
  return "dark"; // photos vary too much to judge — the default text keeps its dark-theme contrast
}

export function gradientCss(
  from: string,
  to: string,
  angle: number = GRAD_DEFAULTS.angle,
  pos: number = GRAD_DEFAULTS.pos,
  soft: number = GRAD_DEFAULTS.soft
): string {
  const half = soft / 2;
  const s1 = clamp(pos - half, 0, 100);
  const s2 = clamp(pos + half, 0, 100);
  return `linear-gradient(${angle}deg, ${from} ${s1}%, ${to} ${s2}%)`;
}

// Decode a stored gradient value into its two stops. New form: "from|to". Legacy form: a preset id.
export function gradientStops(value: string): { from: string; to: string } {
  if (value.includes("|")) {
    const [from, to] = value.split("|");
    return { from: from || BACKGROUND_GRADIENT_PRESETS[0].from, to: to || BACKGROUND_GRADIENT_PRESETS[0].to };
  }
  const preset = BACKGROUND_GRADIENT_PRESETS.find((g) => g.id === value);
  return preset ? { from: preset.from, to: preset.to } : { from: BACKGROUND_GRADIENT_PRESETS[0].from, to: BACKGROUND_GRADIENT_PRESETS[0].to };
}
export const DEFAULT_GRADIENT_VALUE = `${BACKGROUND_GRADIENT_PRESETS[0].from}|${BACKGROUND_GRADIENT_PRESETS[0].to}`;

// Ready-made background photos, served from /public/backgrounds. A streamer picks one in a click or
// uploads their own (which is stored inline as a data URL). Drop new files in that folder and add a
// row here — the gallery iterates this list. (The owner is supplying the real photos; these SVG
// backdrops are on-charter stand-ins so the picker is testable until then.)
// Built-in backdrops (SVG, always present). The streamer's OWN photos aren't listed here — they're
// uploaded via "Your photo" and kept in the per-browser library (lib/data/bgLibrary.ts), so they
// persist as tiles without needing a file on the server.
// Each built-in backdrop ships as a PAIR (the owner's real renders): a tall phone photo and a
// wide desktop one. Picking a preset applies both via the image "split" fit, so neither device
// gets a stretched crop. The old single-file svg/jpg stand-ins stay on disk for pages saved
// before the pairs existed.
export const BACKGROUND_IMAGE_PRESETS: { id: string; label: string; url: string; urlWide?: string }[] = [
  { id: "gym", label: "Gym", url: "/backgrounds/gym-phone.jpg", urlWide: "/backgrounds/gym-desktop.jpg" },
  { id: "aurora", label: "Aurora", url: "/backgrounds/aurora-phone.jpg", urlWide: "/backgrounds/aurora-desktop.jpg" },
  { id: "mesh", label: "Mesh", url: "/backgrounds/mesh-phone.jpg", urlWide: "/backgrounds/mesh-desktop.jpg" },
  { id: "glow", label: "Glow", url: "/backgrounds/glow-phone.jpg", urlWide: "/backgrounds/glow-desktop.jpg" },
  { id: "waves", label: "Waves", url: "/backgrounds/waves-phone.jpg", urlWide: "/backgrounds/waves-desktop.jpg" },
];

// Ready-made looks the streamer can pick in one click (the "templates" gallery). On-charter: themes
// differ by BACKDROP only — the donate button and every accent stay Crown purple (design charter II.1).
export const THEMES: { id: string; label: string; design: PageDesign }[] = [
  { id: "midnight", label: "Midnight", design: { background: { type: "color", value: "#141318" } } },
  { id: "slate", label: "Slate", design: { background: { type: "color", value: "#1B1A21" } } },
  { id: "ink", label: "Ink", design: { background: { type: "color", value: "#101014" } } },
  { id: "dusk", label: "Dusk", design: { background: { type: "gradient", value: "dusk" } } },
  { id: "violet", label: "Violet wash", design: { background: { type: "gradient", value: "violet-wash" } } },
  { id: "deep", label: "Deep", design: { background: { type: "gradient", value: "deep" } } },
];

export function sameBackground(a: PageDesign, b: PageDesign): boolean {
  return a.background.type === b.background.type && a.background.value === b.background.value;
}

// Back-fills profiles saved before the page builder shipped, so they render with sane defaults
// instead of undefined widgets/design.
export function withPageDefaults(
  profile: Profile
): Required<Pick<Profile, "avatarEnabled" | "widgets" | "design" | "task" | "donatePresets">> & Profile {
  return {
    ...profile,
    avatarEnabled: profile.avatarEnabled ?? true,
    widgets: profile.widgets?.length ? profile.widgets : DEFAULT_WIDGETS,
    design: profile.design ?? DEFAULT_DESIGN,
    task: profile.task ?? "",
    donatePresets: profile.donatePresets ?? DEFAULT_DONATE_PRESETS,
  };
}

// isWide = the current viewport is desktop-width (the pages pass useIsWide()). It only matters for a
// "split" image, which serves a different photo per device; every other case ignores it.
export function backgroundStyle(design: PageDesign, isWide = false): CSSProperties {
  const bg = design.background;
  const { type, value } = bg;
  if (type === "image") {
    const fallback = DEFAULT_DESIGN.background.value;
    const url = bg.fit === "split" && isWide && bg.valueWide ? bg.valueWide : value;
    if (!url) return { background: fallback };
    if (bg.fit === "width") {
      // the whole photo, centred at the top — capped at 640px wide so a phone shows it full-width
      // but a desktop DOESN'T blow it up to the full 1280 (that was the "stretches too much" bug);
      // the page colour fills around it. min() keeps the cap responsive on narrow screens.
      // The scrim (first layer) darkens the top where the hero text sits, so a headline stays legible
      // over a light photo; it fills the whole box while the photo keeps its capped size.
      return {
        backgroundImage: `${TEXT_SCRIM}, url(${url})`,
        backgroundSize: "100% 100%, min(100%, 640px) auto",
        backgroundPosition: "top center, top center",
        backgroundRepeat: "no-repeat, no-repeat",
        backgroundColor: fallback,
      };
    }
    // cover (default) and split both fill the screen; plain "cover" also pins to the viewport so it
    // reads the same on a tall phone as on a short desktop (split already picks a per-device photo).
    // The scrim rides on top of the photo so white hero text is readable over a light image.
    return {
      backgroundImage: `${TEXT_SCRIM}, url(${url})`,
      backgroundSize: "cover",
      backgroundPosition: "center",
      backgroundColor: fallback,
      ...(bg.fit === "split" ? {} : { backgroundAttachment: "fixed" }),
    };
  }
  if (type === "gradient") {
    const { from, to } = gradientStops(value);
    return { backgroundImage: gradientCss(from, to, bg.gradAngle, bg.gradPos, bg.gradSoft) };
  }
  return { background: value || DEFAULT_DESIGN.background.value };
}
