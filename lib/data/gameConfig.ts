// Per-session game rules — the knobs the maker turns when they START a session, kept beside
// that session's board instead of on the profile.
//
// Why the same shapes get a second home: `profile.<game>Config` is the maker's STANDING default
// (Settings → the game's rules), and a session is one run of the game that may differ from it —
// two auctions in parallel with different opening prices, a 10-minute wheel spun while
// yesterday's hour-long one is still settling. So a session SNAPSHOTS its rules at birth:
// changing your defaults later must never move the goalposts under money already in escrow.
//
// Stored per SCOPE and keyed by game inside it — the first session of every game adopts the bare
// handle as its scope (gameSessions.ts), so one scope can hold rules for all four. Synced like
// every other game key, so a viewer's browser sees the same minimum the maker set, not the
// profile default it would otherwise fall back to.

import { withFundraiserDefaults, DEFAULT_FUNDRAISER } from "./fundraiser";
import { sendOp } from "./gameSync";
import type { GameId } from "./games";
import type { AuctionConfig, FundraiserConfig, Profile, RouletteConfig, TaskGameConfig } from "./types";
import { DEFAULT_TASK_CONFIG } from "@/components/TaskGameSettings";
import { DEFAULT_ROULETTE_CONFIG } from "@/components/RouletteGameSettings";
import { DEFAULT_FUNDRAISER_CONFIG } from "@/components/FundraiserGameSettings";
import { DEFAULT_AUCTION_CONFIG } from "@/components/AuctionGameSettings";

// The fundraiser is the one game whose target belongs to the RUN, not to the standing rules:
// every collection is opened for its own amount ("$300 for the new mic"), and it's what the
// funding canister is handed at creation.
export interface FundraiserSessionRules extends FundraiserConfig {
  goal: number;
}

export interface ScopeRules {
  task?: TaskGameConfig;
  roulette?: RouletteConfig;
  fundraiser?: FundraiserSessionRules;
  auction?: AuctionConfig;
}

export const RULES_KEY = "crown-game-config";

export function readScopeRules(scope: string): ScopeRules {
  try {
    const raw = localStorage.getItem(`${RULES_KEY}:${scope}`);
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as ScopeRules) : {};
  } catch {
    return {};
  }
}

// Written once, when the session is created. Single-writer (only the maker's cabinet opens a
// session), so a plain authoritative overwrite is the right op.
export function writeSessionRules<K extends GameId>(scope: string, gameId: K, rules: NonNullable<ScopeRules[K]>): void {
  const next: ScopeRules = { ...readScopeRules(scope), [gameId]: rules };
  try {
    localStorage.setItem(`${RULES_KEY}:${scope}`, JSON.stringify(next));
  } catch {}
  sendOp(scope, RULES_KEY, { type: "replace", value: next });
}

// ---- resolvers -------------------------------------------------------------
// The order is always the same, and it's the whole point of this module:
//   platform default → the maker's standing rules → this session's snapshot.
// A page that has no scope yet (still resolving, or a surface that predates sessions) simply
// stops at the maker's rules — exactly the behaviour these call sites had before.

export function taskRules(profile: Profile | null | undefined, scope: string | null): TaskGameConfig {
  return { ...DEFAULT_TASK_CONFIG, ...profile?.taskConfig, ...(scope ? readScopeRules(scope).task : undefined) };
}

export function rouletteRules(profile: Profile | null | undefined, scope: string | null): RouletteConfig {
  return { ...DEFAULT_ROULETTE_CONFIG, ...profile?.rouletteConfig, ...(scope ? readScopeRules(scope).roulette : undefined) };
}

export function fundraiserRules(profile: Profile | null | undefined, scope: string | null): FundraiserSessionRules {
  return {
    goal: profile ? withFundraiserDefaults(profile).goal : DEFAULT_FUNDRAISER.goal,
    ...DEFAULT_FUNDRAISER_CONFIG,
    ...profile?.fundraiserConfig,
    ...(scope ? readScopeRules(scope).fundraiser : undefined),
  };
}

export function auctionRules(profile: Profile | null | undefined, scope: string | null): AuctionConfig {
  return { ...DEFAULT_AUCTION_CONFIG, ...profile?.auctionConfig, ...(scope ? readScopeRules(scope).auction : undefined) };
}
