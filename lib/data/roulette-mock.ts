// Mock data for the Roulette game — viewers suggest a game to play by donating toward it, then
// a weighted spin picks one (front.md I §5: the game is a front-end layer, donations are plain
// donations). No backend yet — this seeds the cabinet's Overview/History tabs.

export const GAME_GENRES = ["Action", "Shooter", "Strategy", "RPG", "Sports", "Horror", "Party", "Simulation", "Racing", "Other"] as const;
export type GameGenre = (typeof GAME_GENRES)[number];

export interface RouletteSuggestion {
  id: string;
  title: string;
  genre: GameGenre;
  pool: number; // $ total backing this suggestion
  backers: number; // distinct donors
  suggestedBy: string; // whoever proposed it first
}

// The open round: what viewers have suggested and backed so far.
export const MOCK_ROUND: RouletteSuggestion[] = [
  { id: "s1", title: "Warcraft III", genre: "Strategy", pool: 1000, backers: 6, suggestedBy: "Timur" },
  { id: "s2", title: "Fortnite", genre: "Shooter", pool: 500, backers: 4, suggestedBy: "anna_k" },
  { id: "s3", title: "Dota 2", genre: "Strategy", pool: 100, backers: 2, suggestedBy: "Dan" },
];

export interface RouletteRound {
  id: string;
  date: string;
  winner: string;
  genre: GameGenre;
  pot: number;
  entries: number;
  playedMinutes: number;
}

export const MOCK_ROULETTE_HISTORY: RouletteRound[] = [
  { id: "r1", date: "Jul 10, 2026", winner: "Elden Ring", genre: "RPG", pot: 820, entries: 4, playedMinutes: 90 },
  { id: "r2", date: "Jul 6, 2026", winner: "Warcraft III", genre: "Strategy", pot: 640, entries: 3, playedMinutes: 60 },
  { id: "r3", date: "Jun 30, 2026", winner: "Fortnite", genre: "Shooter", pot: 410, entries: 5, playedMinutes: 45 },
];

// Deterministic per-round rand in [0,1): mulberry32 seeded by the round clock's zero. Every
// browser that agrees on startedAt (the synced meta) computes the SAME spin — so an expiring
// round lands on one winner everywhere, with no coordinator and no race between tabs.
export function roundRand(seed: number): number {
  let t = (seed >>> 0) + 0x6d2b79f5;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// Weighted-random pick — pool share = odds. Mirrors what the real spin will do server-side
// later; kept pure (rand passed in) so the Overview tab can demo it client-side with no backend.
// `weights` overrides the default "pool = odds". Elimination rounds pass inverted pools, so the
// best-backed suggestion is the LEAST likely to be picked (picked = knocked out there).
export function pickWeighted(rows: RouletteSuggestion[], rand: number, weights?: number[]): RouletteSuggestion | null {
  const w = weights && weights.length === rows.length ? weights : rows.map((r) => r.pool);
  const total = w.reduce((sum, n) => sum + n, 0);
  // Rank mode can spin a wheel nobody has backed yet — no money means equal slices, not no spin.
  if (!total) return rows.length ? rows[Math.min(rows.length - 1, Math.floor(rand * rows.length))] : null;
  let acc = 0;
  const target = rand * total;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    acc += w[i];
    // strict "<" so a slice's upper boundary belongs to the next slice, and a zero-pool
    // suggestion (acc unchanged) can never be the one that first exceeds the target
    if (target < acc) return r;
  }
  return rows[rows.length - 1];
}
