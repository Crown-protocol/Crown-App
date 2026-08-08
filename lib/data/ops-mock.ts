import type { Social } from "./types";
import type { GameId } from "./games";

// Operator panel data — mock (real data will come from cheer-app/api + the canister).
// Terms per the charter: streamers (not realms), donations/received (not cheered), donators (not viewers,
// not supporters) — "viewers" is the cabinet's retired term (front.md §6); this panel tracks who paid.

export const OPS_STATS = {
  streamers: 22,
  streamersActive: 22,
  streamersLive: 9,
  received: 720635, // total received, $
  last7d: 9105,
  fee: 21619, // 3% fee, $
  donators: 24,
  avgPerStreamer: 32756,
  largest: 304335,
};

// Growth: two separate series (one chart = one axis). Money in white, donators in purple.
// received is cumulative real dollars — last point matches OPS_STATS.received exactly, so
// hover tooltips and the headline number always agree with the summary tiles above.
export const OPS_GROWTH = {
  received: [
    12000, 34000, 58000, 96000, 150000, 205000, 250000, 300000, 355000, 400000, 430000, 470000, 505000, 540000,
    560000, 590000, 610000, 630000, 650000, 665000, 678000, 690000, 700000, 706000, 712000, 716000, 719000, 720635,
  ],
  donators: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 20, 21, 22, 22, 23, 23, 24, 24],
  // one date per point above, oldest first — today is Jul 12, 2026.
  dates: [
    "Jun 15", "Jun 16", "Jun 17", "Jun 18", "Jun 19", "Jun 20", "Jun 21", "Jun 22", "Jun 23", "Jun 24", "Jun 25",
    "Jun 26", "Jun 27", "Jun 28", "Jun 29", "Jun 30", "Jul 1", "Jul 2", "Jul 3", "Jul 4", "Jul 5", "Jul 6", "Jul 7",
    "Jul 8", "Jul 9", "Jul 10", "Jul 11", "Jul 12",
  ],
};

export const OPS_BY_PLATFORM = [
  { kind: "twitch" as Social["kind"], label: "Twitch", value: 559000 },
  { kind: "youtube" as Social["kind"], label: "YouTube", value: 129000 },
  { kind: "tiktok" as Social["kind"], label: "TikTok", value: 24000 },
  { kind: "instagram" as Social["kind"], label: "Instagram", value: 9000 },
];

export const OPS_BY_SIZE = [
  { label: "under $1k", value: 1 },
  { label: "$1k–10k", value: 10 },
  { label: "$10k–100k", value: 10 },
  { label: "$100k+", value: 1 },
];

export const OPS_GAME_ADOPTION = [
  { label: "Tasks", value: 6 },
  { label: "Roulette", value: 0 },
  { label: "Fundraiser", value: 0 },
];

// Same cumulative shape as OPS_GROWTH.received, split by each platform's share of the
// total (OPS_BY_PLATFORM) — a plausible mock, not organic per-platform variation.
const platformTotal = OPS_BY_PLATFORM.reduce((sum, p) => sum + p.value, 0);
export const OPS_GROWTH_BY_PLATFORM: Record<string, number[]> = Object.fromEntries(
  OPS_BY_PLATFORM.map((p) => [p.kind, OPS_GROWTH.received.map((v) => Math.round((v * p.value) / platformTotal))])
);

// Real cumulative $ moved through each game's escrow tasks, by date (derived from OPS_TASKS
// below — Jun 28 through Jul 12). Roulette and Fundraiser are still "building" (lib/data/games.ts) —
// zero is the honest number, not a placeholder.
export const OPS_GROWTH_BY_GAME: Record<GameId, number[]> = {
  task: [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // Jun 15–27
    50, 50, 50, // Jun 28–30
    65, 65, 65, // Jul 1–3
    125, 125, // Jul 4–5
    165, // Jul 6
    185, // Jul 7
    250, // Jul 8
    285, // Jul 9
    295, 295, 295, // Jul 10–12
  ],
  roulette: new Array(28).fill(0),
  fundraiser: new Array(28).fill(0),
  auction: new Array(28).fill(0),
};

// Tasks (escrow) by status — for the summary.
export const OPS_TASK_STATUS = [
  { label: "Awaiting content maker", value: 3, tone: "wait" as const },
  { label: "In progress", value: 2, tone: "wait" as const },
  { label: "In review", value: 2, tone: "wait" as const },
  { label: "Dispute", value: 1, tone: "attn" as const },
  { label: "Completed", value: 2, tone: "ok" as const },
];

export type StreamerRow = {
  handle: string;
  name: string;
  socials: Social["kind"][];
  received: number;
  d7: number;
  donators: number;
  live: boolean;
};

export const OPS_STREAMERS: StreamerRow[] = [
  { handle: "raidboss", name: "RAIDBOSS", socials: ["twitch", "kick", "x"], received: 304335, d7: 275, donators: 8, live: true },
  { handle: "pixelqueen", name: "PIXELQUEEN", socials: ["twitch", "x", "instagram", "telegram"], received: 71805, d7: 1265, donators: 9, live: false },
  { handle: "latenight", name: "LATE NIGHT", socials: ["twitch", "tiktok"], received: 58065, d7: 485, donators: 7, live: false },
  { handle: "retroarcade", name: "RETROARCADE", socials: ["twitch", "x", "kick"], received: 44210, d7: 510, donators: 4, live: true },
  { handle: "novapaints", name: "NOVA", socials: ["youtube", "instagram", "x"], received: 42320, d7: 320, donators: 5, live: true },
  { handle: "djmix", name: "DJ MIX", socials: ["twitch", "instagram", "tiktok"], received: 36110, d7: 30, donators: 4, live: false },
  { handle: "flashrun", name: "FLASHRUN", socials: ["twitch", "x", "kick"], received: 31240, d7: 140, donators: 4, live: false },
  { handle: "petpals", name: "PETPALS", socials: ["tiktok", "instagram", "youtube"], received: 23855, d7: 355, donators: 4, live: true },
  { handle: "astronyx", name: "ASTRONYX", socials: ["youtube", "twitch", "kick"], received: 18020, d7: 120, donators: 4, live: false },
  { handle: "lofimira", name: "MIRA", socials: ["youtube", "instagram", "tiktok", "telegram"], received: 16530, d7: 610, donators: 8, live: false },
  { handle: "devbyte", name: "DEVBYTE", socials: ["youtube", "twitch"], received: 10940, d7: 290, donators: 7, live: true },
  { handle: "marinacooks", name: "MARINA COOKS", socials: ["youtube", "instagram"], received: 9135, d7: 835, donators: 6, live: true },
  { handle: "beatlab", name: "BEATLAB", socials: ["youtube", "instagram", "twitch"], received: 8240, d7: 740, donators: 4, live: false },
  { handle: "paintpal", name: "PAINTPAL", socials: ["youtube", "twitch"], received: 7880, d7: 380, donators: 3, live: false },
  { handle: "talehunter", name: "TALEHUNTER", socials: ["twitch", "youtube", "kick"], received: 7550, d7: 650, donators: 4, live: false },
];

export type TaskStatus = "await" | "progress" | "review" | "dispute" | "vote" | "refund" | "paid";

export const TASK_STATUS_META: Record<TaskStatus, { label: string; tone: "wait" | "attn" | "ok" | "bad"; note?: string }> = {
  await: { label: "Awaiting content maker", tone: "wait" },
  progress: { label: "In progress", tone: "wait" },
  review: { label: "Review window", tone: "wait" },
  dispute: { label: "Dispute", tone: "attn" },
  vote: { label: "Vote", tone: "attn" },
  refund: { label: "Refunded to donator", tone: "bad", note: "not completed" },
  paid: { label: "Paid to content maker", tone: "ok", note: "completed" },
};

export type TaskRow = {
  date: string;
  handle: string;
  task: string;
  supporter: string;
  amount: number;
  status: TaskStatus;
};

export const OPS_TASKS: TaskRow[] = [
  { date: "Jul 10, 2026", handle: "codegolf", task: "Break down yesterday's one-liner for shortest path.", supporter: "tXPG…W5u4", amount: 10, status: "await" },
  { date: "Jul 9, 2026", handle: "raidboss", task: "Beat the boss using a dance pad — no keyboard, live.", supporter: "S3m2…AK9C", amount: 25, status: "await" },
  { date: "Jul 9, 2026", handle: "rooknroll", task: "Solve today's chess puzzle blindfolded.", supporter: "5mer…1fJg", amount: 10, status: "await" },
  { date: "Jul 8, 2026", handle: "devbyte", task: "Refactor the auth module live and explain every step.", supporter: "cb9a…27qN", amount: 30, status: "progress" },
  { date: "Jul 8, 2026", handle: "codegolf", task: "Golf FizzBuzz down to 60 bytes and explain the tricks.", supporter: "V9UY…H9EY", amount: 35, status: "progress" },
  { date: "Jul 7, 2026", handle: "retroarcade", task: "Clear the first level of Pac-Man on the arcade cabinet.", supporter: "JqhC…n9Kx", amount: 20, status: "review" },
  { date: "Jul 6, 2026", handle: "raidboss", task: "No-damage run through the tutorial zone tonight.", supporter: "NZBv…Cou2", amount: 40, status: "review" },
  { date: "Jul 4, 2026", handle: "flashrun", task: "Any% run of level 1 under 20 seconds, no skips.", supporter: "xMDU…nmDz", amount: 60, status: "dispute" },
  { date: "Jul 1, 2026", handle: "rooknroll", task: "Win a game after opening with the Bongcloud.", supporter: "4Hjz…2qKv", amount: 15, status: "refund" },
  { date: "Jun 28, 2026", handle: "devbyte", task: "Review my open-source PR live and merge it if it's good.", supporter: "XMQk…Xsg4", amount: 50, status: "paid" },
];

export type DonatorRow = {
  addr: string;
  donated: number;
  reputation: number;
  streamers: number;
  last: string;
};

export const OPS_DONATORS: DonatorRow[] = [
  { addr: "7aF3sE…qKy3", donated: 1240, reputation: 1240, streamers: 5, last: "2 min ago" },
  { addr: "Bx4dE…9fQ4", donated: 860, reputation: 860, streamers: 3, last: "34 min ago" },
  { addr: "9c2Wq…4a7E", donated: 610, reputation: 610, streamers: 4, last: "1 hour ago" },
  { addr: "3b8Kp…d5C1", donated: 505, reputation: 505, streamers: 2, last: "3 hours ago" },
  { addr: "F27aV…8b9Q", donated: 430, reputation: 430, streamers: 6, last: "today" },
  { addr: "6JcQ4…1e3D", donated: 355, reputation: 355, streamers: 2, last: "yesterday" },
  { addr: "8VaZ1…7cF2", donated: 290, reputation: 290, streamers: 3, last: "yesterday" },
  { addr: "D4eW9…2b6Q", donated: 210, reputation: 210, streamers: 1, last: "2 days ago" },
];

export const PENALTY_LADDER = [
  { n: 1, label: "Hide / remove message", severe: false },
  { n: 2, label: "Block the content maker's page", severe: false },
  { n: 3, label: "Temporarily suspend the page", severe: false },
  { n: 4, label: "Revoke content maker role", severe: true },
  { n: 5, label: "Full wallet block", severe: true },
  { n: 6, label: "Refer to law enforcement", severe: true },
];

export const APPLY_ACTIONS = [
  "Hide message",
  "Block page",
  "Suspend page",
  "Revoke content maker role",
  "Block wallet",
];
