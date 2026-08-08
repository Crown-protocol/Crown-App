import type { Streamer, Donation, Campaign, Tier } from "./types";
import type { GameId } from "./games";

// Shared default tier ladder for the mock world. Real streamers name and color their own
// in the create wizard (front.md I §6) — this is just a plausible starting set for demos.
const DEFAULT_TIERS: Tier[] = [
  { name: "Newcomer", threshold: 0, color: "#9AA0AE" },
  { name: "Regular", threshold: 10, color: "#5B9BF0" },
  { name: "VIP", threshold: 100, color: "#F0B94F" },
  { name: "Legend", threshold: 1000, color: "#8B7CF6" },
];

// The demo content maker the marketing surfaces point at: the "See an example" link, the
// footer, the hero phones and the donate demo. Named ONCE here — it used to be spelled out in
// two dozen places, which made swapping it a hunt.
export const DEMO_HANDLE = "nova";
export const DEMO_NAME = "Nova";

// One shared mock world (the same one used in the F1 mockups).
export const MOCK_STREAMERS: Record<string, Streamer> = {
  nova: {
    handle: "nova",
    name: "Nova",
    address: "3JF3sEqM796hk5WFqA6EtmEwJQ9quALszsfJyvXNQKy3",
    socials: [
      { kind: "youtube", url: "https://youtube.com/@nova" },
      { kind: "instagram", url: "https://instagram.com/nova" },
      { kind: "twitch", url: "https://twitch.tv/nova" },
    ],
    tiers: DEFAULT_TIERS,
  },
  glitch: {
    handle: "glitch",
    name: "Glitch",
    address: "4Ss5JMkXAD9Z7cktFEdrqeMuT6jGMF1pVozTyPHZ6zT4",
    socials: [
      { kind: "twitch", url: "https://twitch.tv/glitch" },
      { kind: "kick", url: "https://kick.com/glitch" },
      { kind: "x", url: "https://x.com/glitch" },
    ],
    tiers: DEFAULT_TIERS,
  },
  miradev: {
    handle: "miradev",
    name: "Mira",
    address: "5bV6jUfhDHCQVA1WfKBUnXUsboJgoKgkzkKcxr3joew5",
    socials: [
      { kind: "youtube", url: "https://youtube.com/@miradev" },
      { kind: "telegram", url: "https://t.me/miradev" },
      { kind: "x", url: "https://x.com/miradev" },
    ],
    tiers: DEFAULT_TIERS,
  },
  volk: {
    handle: "volk",
    name: "Wolf",
    address: "6k78AbasGMFFrhG95Pj6jQbqkVt7FQMhVgemxJovWKR6",
    socials: [
      { kind: "twitch", url: "https://twitch.tv/volk" },
      { kind: "kick", url: "https://kick.com/volk" },
      { kind: "telegram", url: "https://t.me/volk" },
    ],
    tiers: DEFAULT_TIERS,
  },
  sonya: {
    handle: "sonya",
    name: "Sonya",
    address: "7tj9biW3KRJ7EEWmVUGigHiouCTXhV2dzcyvwma7Cyu7",
    socials: [
      { kind: "youtube", url: "https://youtube.com/@sonya" },
      { kind: "tiktok", url: "https://tiktok.com/@sonya" },
      { kind: "instagram", url: "https://instagram.com/sonya" },
    ],
    tiers: DEFAULT_TIERS,
  },
  raidkeeper: {
    handle: "raidkeeper",
    name: "Keeper",
    address: "93MB2qRDNVLxbmmPuYpLdAqn3u2x9ZhaVZK5wELHueP8",
    socials: [
      { kind: "twitch", url: "https://twitch.tv/raidkeeper" },
      { kind: "x", url: "https://x.com/raidkeeper" },
      { kind: "youtube", url: "https://youtube.com/@raidkeeper" },
    ],
    tiers: DEFAULT_TIERS,
  },
  pixelira: {
    handle: "pixelira",
    name: "Pixie",
    address: "AByCTxLPRZPoyK22KdMxa3xkCbcNbeNWzVeEvh6UcJs9",
    socials: [
      { kind: "instagram", url: "https://instagram.com/pixelira" },
      { kind: "tiktok", url: "https://tiktok.com/@pixelira" },
      { kind: "telegram", url: "https://t.me/pixelira" },
    ],
    tiers: DEFAULT_TIERS,
  },
};

// Homepage showcase: per-streamer aggregates (hardcoded in mock,
// will come from the indexer in chain mode). The "cheer" goes to whoever donated the most.
export interface RealmStat {
  handle: string; // without "@", the key in MOCK_STREAMERS
  receivedAll: number; // total received, $
  received7d: number; // received over the last 7 days, $
  spark: number[]; // mini-chart points (receipts over time)
  cheer: string; // name of whoever holds the cheer
}

export const MOCK_REALMS: RealmStat[] = [
  { handle: "nova", receivedAll: 31450, received7d: 2740, cheer: "lesya", spark: [8, 9, 7, 11, 10, 14, 13, 17, 15, 19, 18, 22, 20, 25, 24, 28] },
  { handle: "glitch", receivedAll: 27200, received7d: 4100, cheer: "Anonymous", spark: [20, 16, 22, 18, 26, 21, 15, 24, 28, 22, 30, 26, 34, 29, 38, 41] },
  { handle: "miradev", receivedAll: 19880, received7d: 1580, cheer: "Dan", spark: [6, 7, 6, 9, 8, 11, 10, 9, 13, 12, 15, 14, 17, 16, 19, 20] },
  { handle: "volk", receivedAll: 15340, received7d: 2210, cheer: "Maximus", spark: [14, 12, 16, 13, 18, 20, 15, 22, 19, 24, 21, 26, 23, 28, 25, 30] },
  { handle: "sonya", receivedAll: 11760, received7d: 1890, cheer: "anna_k", spark: [9, 11, 10, 13, 12, 15, 14, 16, 15, 18, 17, 20, 19, 21, 20, 23] },
  { handle: "raidkeeper", receivedAll: 8430, received7d: 990, cheer: "Whale", spark: [10, 8, 12, 9, 11, 14, 10, 13, 16, 12, 15, 18, 14, 17, 15, 19] },
  { handle: "pixelira", receivedAll: 4275, received7d: 640, cheer: "Julia", spark: [4, 5, 4, 6, 5, 7, 6, 8, 7, 9, 8, 10, 9, 11, 10, 12] },
];

export const MOCK_FEED: Donation[] = [
  { id: "d1", from: "Max", amount: 10, message: "For yesterday's stream. That ending was top tier", source: "direct", date: "2026-07-14", time: "2 min ago" },
  { id: "d2", from: "anna_k", amount: 5, message: "Hey from Saint Petersburg!", source: "roulette", date: "2026-07-14", time: "34 min ago" },
  { id: "d2a", from: "Timur", amount: 60, message: "My lot: hardest difficulty, no saves", source: "auction", date: "2026-07-14", time: "1 hour ago" },
  { id: "d3", from: "Anonymous", amount: 1, source: "direct", date: "2026-07-14", time: "1 hour ago" },
  { id: "d4", from: "Timur", amount: 50, message: "For the mic. Waiting for that hiss-free sound", source: "fundraiser", date: "2026-07-14", time: "3 hours ago" },
  { id: "d5", from: "lesya", amount: 5, message: "Thanks for the cozy streams", source: "direct", date: "2026-07-13", time: "yesterday" },
  { id: "d6", from: "Dan", amount: 25, message: "GG on the horror marathon", source: "task", date: "2026-07-13", time: "yesterday" },
  { id: "d7", from: "kirill_v", amount: 15, message: "Play Elden Ring next!", source: "roulette", date: "2026-07-13", time: "yesterday" },
  { id: "d8", from: "Nastya", amount: 3, source: "direct", date: "2026-07-12", time: "2 days ago" },
  { id: "d9", from: "Max", amount: 20, message: "Do 10 push-ups on stream", source: "task", date: "2026-07-12", time: "2 days ago" },
  { id: "d10", from: "Oleg", amount: 8, message: "For the new mic fund", source: "fundraiser", date: "2026-07-10", time: "4 days ago" },
  { id: "d11", from: "vika", amount: 5, source: "direct", date: "2026-07-10", time: "4 days ago" },
  { id: "d12", from: "anna_k", amount: 12, message: "Spin the wheel!", source: "roulette", date: "2026-07-07", time: "1 week ago" },
  { id: "d13", from: "Timur", amount: 30, message: "Marathon fund", source: "fundraiser", date: "2026-07-01", time: "2 weeks ago" },
  { id: "d14", from: "Anonymous", amount: 2, source: "direct", date: "2026-07-01", time: "2 weeks ago" },
];

// A viewer's reputation with a streamer.
export const MOCK_REPUTATION: Record<string, number> = { [DEMO_HANDLE]: 42 };

export const MOCK_CAMPAIGNS: Record<string, Campaign> = {
  "nova/mikrofon": {
    handle: "nova",
    slug: "mikrofon",
    kind: "raise",
    title: "Raising for a new microphone",
    lead: "The old one started buzzing — you've heard it. Raising for a Shure MV7 and a stand.",
    goal: 500,
    raised: 327,
    count: 23,
  },
};

// Cabinet data — three periods ("7", "30", "all"). In chain mode this will come from
// the indexer; here it's hardcoded to mock out the cabinet's "Home" screen.
export type DashboardPeriodKey = "7" | "30" | "all";

// Breakdown of donations by source: "direct" is a regular donation with no game, the rest are lib/data/games.GameId.
export interface ByGameRow {
  id: GameId | "direct";
  amount: number;
}

// The sources the Home chart can be filtered by — a regular donation plus each mini-game.
export type DonationSource = GameId | "direct";
export const DONATION_SOURCES: DonationSource[] = ["direct", "task", "roulette", "fundraiser", "auction"];

// Splits a period's daily totals across the sources, shaped so each game has its own curve
// (a fixed per-source wave) while every day's columns still add up to that day's total.
// Deterministic — no RNG — so the chart is stable across renders. The real per-source series
// will come from the indexer; this mocks it out from the totals + the by-game breakdown.
export function splitByGame(p: DashboardPeriod): Record<DonationSource, number[]> {
  const out: Record<DonationSource, number[]> = { direct: [], task: [], roulette: [], fundraiser: [], auction: [] };
  const base = Object.fromEntries(DONATION_SOURCES.map((k) => [k, 0])) as Record<DonationSource, number>;
  for (const g of p.byGame) base[g.id] = g.amount;

  p.days.forEach((total, i) => {
    // Each source's weight = its overall share, nudged by a per-source wave so shapes differ.
    const raw = DONATION_SOURCES.map((k, ki) => Math.max(0, base[k] * (1 + 0.45 * Math.sin(i * 0.7 + ki * 1.7))));
    const sum = raw.reduce((a, b) => a + b, 0) || 1;
    let assigned = 0;
    const amounts = raw.map((r) => {
      const v = Math.round((total * r) / sum);
      assigned += v;
      return v;
    });
    // Push the rounding drift onto the largest slice so the column sums exactly to `total`.
    const drift = total - assigned;
    if (drift !== 0) {
      let maxI = 0;
      for (let j = 1; j < amounts.length; j++) if (amounts[j] > amounts[maxI]) maxI = j;
      amounts[maxI] = Math.max(0, amounts[maxI] + drift);
    }
    DONATION_SOURCES.forEach((k, ki) => out[k].push(amounts[ki]));
  });
  return out;
}

export interface DashboardPeriod {
  received: number;
  donations: number;
  newViewers: number;
  peakLabel: string;
  days: number[]; // chart points for the period (days, or for "all", months)
  labels: string[]; // one label per point in `days` — the date the chart's hover tooltip shows
  peakValue: number;
  axis: string[]; // 3 axis labels
  byGame: ByGameRow[];
}

export const MOCK_DASHBOARD: Record<DashboardPeriodKey, DashboardPeriod> = {
  "7": {
    received: 332,
    donations: 23,
    newViewers: 3,
    peakLabel: "Jul 6 · 84 $",
    days: [38, 56, 84, 30, 64, 18, 42],
    labels: ["Jul 4", "Jul 5", "Jul 6", "Jul 7", "Jul 8", "Jul 9", "Jul 10"],
    peakValue: 84,
    axis: ["Jul 4", "Jul 7", "Jul 10"],
    byGame: [
      { id: "direct", amount: 244 },
      { id: "task", amount: 46 },
      { id: "roulette", amount: 20 },
      { id: "fundraiser", amount: 8 },
      { id: "auction", amount: 14 },
    ],
  },
  "30": {
    received: 1284,
    donations: 96,
    newViewers: 12,
    peakLabel: "Jul 4 · 120 $",
    days: [32, 22, 44, 45, 0, 51, 38, 22, 60, 19, 34, 48, 24, 55, 28, 42, 36, 39, 64, 31, 29, 47, 58, 33, 120, 52, 46, 39, 61, 44, 21],
    labels: [
      "Jun 10", "Jun 11", "Jun 12", "Jun 13", "Jun 14", "Jun 15", "Jun 16", "Jun 17", "Jun 18", "Jun 19", "Jun 20",
      "Jun 21", "Jun 22", "Jun 23", "Jun 24", "Jun 25", "Jun 26", "Jun 27", "Jun 28", "Jun 29", "Jun 30",
      "Jul 1", "Jul 2", "Jul 3", "Jul 4", "Jul 5", "Jul 6", "Jul 7", "Jul 8", "Jul 9", "Jul 10",
    ],
    peakValue: 120,
    axis: ["Jun 10", "Jun 25", "Jul 10"],
    byGame: [
      { id: "direct", amount: 920 },
      { id: "task", amount: 210 },
      { id: "roulette", amount: 84 },
      { id: "fundraiser", amount: 36 },
      { id: "auction", amount: 34 },
    ],
  },
  all: {
    received: 20490,
    donations: 1830,
    newViewers: 640,
    peakLabel: "Jun 2026 · 3,240 $",
    days: [820, 910, 760, 1040, 1180, 1340, 1520, 1890, 2210, 2640, 3240, 2940],
    labels: [
      "Aug 2025", "Sep 2025", "Oct 2025", "Nov 2025", "Dec 2025", "Jan 2026",
      "Feb 2026", "Mar 2026", "Apr 2026", "May 2026", "Jun 2026", "Jul 2026",
    ],
    peakValue: 3240,
    axis: ["Aug 2025", "Feb 2026", "Jul 2026"],
    byGame: [
      { id: "direct", amount: 13920 },
      { id: "task", amount: 3600 },
      { id: "roulette", amount: 1800 },
      { id: "fundraiser", amount: 690 },
      { id: "auction", amount: 480 },
    ],
  },
};
