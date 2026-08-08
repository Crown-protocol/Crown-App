// The OBS overlays (front.md §1, §6). Data-only so the overlay routes, the cabinet Widgets panel,
// and the landing showcase all iterate the same list. A streamer adds an overlay to OBS as a
// Browser Source by its URL. Three general widgets + one per mini-game.

export type OverlayKind =
  | "alerts"
  | "rank"
  | "goal"
  | "top"
  | "roulette"
  | "task"
  | "fundraiser"
  | "auction"
  | "ticker"
  | "qr"
  | "session"
  | "record"
  | "train";

// Which mini-game a widget belongs to, if it's game-specific (used to group them in the cabinet).
export type OverlayGame = "roulette" | "task" | "fundraiser" | "auction";

export interface OverlayDef {
  kind: OverlayKind;
  label: string;
  desc: string;
  game?: OverlayGame;
}

export const OVERLAYS: OverlayDef[] = [
  // general — driven by donations
  { kind: "alerts", label: "Alerts", desc: "A popup for every new donation — name, amount, message." },
  { kind: "rank", label: "Rank-up", desc: "A popup when a viewer reaches a new tier — “Timur reached VIP”." },
  { kind: "goal", label: "Goal", desc: "A progress bar toward your fundraising goal." },
  { kind: "top", label: "Top donors", desc: "A live leaderboard of your biggest supporters." },
  // one per mini-game
  { kind: "roulette", label: "Roulette", desc: "The live wheel — the pot and what's winning right now.", game: "roulette" },
  { kind: "task", label: "Task", desc: "The active paid task and how long is left to do it.", game: "task" },
  { kind: "fundraiser", label: "Fundraiser", desc: "A cheer that fills toward the goal as viewers chip in.", game: "fundraiser" },
  { kind: "auction", label: "Auction", desc: "The live lot board — what's leading and by how much.", game: "auction" },
  // general — batch 2, donation-driven (components/overlays/Extras.tsx)
  { kind: "ticker", label: "Donation ticker", desc: "A thin broadcast-style strip of recent donations along the screen edge, with the session total pinned right." },
  { kind: "qr", label: "Donate QR", desc: "An always-on corner QR code pointing at the streamer's donate page, pulsing on live donations." },
  { kind: "session", label: "Stream total", desc: "A minimal pill showing everything raised this stream, live, with an odometer roll on every donation." },
  { kind: "record", label: "Stream record", desc: "The stream's biggest single donation, standing as a public challenge — with a coronation when someone beats it." },
  { kind: "train", label: "Donation train", desc: "A combo counter that grows while donations keep coming and dies when they stop — one shared timer for all of chat to beat." },
];

export function isOverlayKind(v: string): v is OverlayKind {
  return OVERLAYS.some((o) => o.kind === v);
}

// A viewer's rank ladder for the Rank-up overlay (mock — the real one is the streamer's tiers).
export const OVERLAY_TIERS: { name: string; at: number }[] = [
  { name: "Regular", at: 25 },
  { name: "VIP", at: 100 },
  { name: "Legend", at: 500 },
];

// Default goal for the demo/mock goal + fundraiser overlays (real value comes from the campaign).
export const DEMO_GOAL = 500;
export const DEMO_GOAL_START = 327;
export const DEMO_FUNDRAISER_GOAL = 2000;
