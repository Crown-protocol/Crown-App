import type { GameId } from "./games";

export type DataMode = "mock" | "chain";

export interface Social {
  kind: "youtube" | "twitch" | "kick" | "x" | "tiktok" | "instagram" | "telegram" | "onlyfans";
  url: string;
  // Stable per-row id, assigned when a row is added in an editor. React keys the socials list by it,
  // so removing a middle row doesn't make the inputs reconcile by index (caret/focus bleed). Optional
  // for legacy rows saved before this existed — those fall back to an index key.
  id?: string;
}

// A named, colored reputation tier a streamer defines for their viewers.
// threshold is in dollars donated (== reputation, front.md I §4: $1 donated = 1 reputation).
export interface Tier {
  name: string;
  threshold: number;
  color: string; // hex, chosen by the streamer
}

export interface Streamer {
  handle: string; // without "@"
  name: string;
  bio?: string; // the "about" line shown on the public page
  address: string; // where donations arrive — a base58 Solana pubkey (validated at entry, lib/chain/config isValidAddress)
  socials: Social[];
  tiers: Tier[];
  donatePresets?: number[]; // custom amount chips from the page builder; DonateForm falls back to [1,5,10]
  avatarUrl?: string; // uploaded avatar (data URL); when absent, surfaces fall back to the monogram
  avatarEnabled?: boolean; // owner can hide the avatar entirely
}

export interface Donation {
  id: string;
  from: string; // viewer name (or address)
  amount: number; // in dollars
  message?: string;
  time: string; // human-readable "2 min ago"
  date?: string; // ISO "2026-07-14" — the calendar day, for grouping/filtering in the cabinet
  source?: GameId | "direct"; // which mini-game it came through, or a plain donation
  fresh?: boolean;
  // On-chain extras (present on real Settled rows from the indexer; absent on mock/local ones).
  at?: number; // unix ms of the settle — a precise clock, not just the calendar day
  sig?: string; // Solana tx signature — links the row to the block explorer
  payer?: string; // donor's base58 wallet address (for anonymous donors, `from` is a short form of this)
  streamer?: string; // recipient's base58 payout address — who this donation was FOR. The feed is one
  // global stream, so every surface that shows a single maker's money filters on this.
  // Where the money is. "settled" — the indexer saw it finalized on-chain and it is in the payout
  // wallet. "sending" — the donor submitted and we have their intent, but no Settled event yet.
  // Absent means settled: every row that predates this field came from the confirmed table.
  status?: "settled" | "sending";
  // Set only on a row built by the cabinet's "Merge by name" view: how many donations were folded
  // into it. Its own field rather than overwriting `message`, so a merged row keeps the donor's
  // actual words — otherwise "With message" filtered for messages and then replaced them with a count.
  mergedCount?: number;
}

export interface Campaign {
  handle: string;
  slug: string;
  kind: "raise" | "game" | "ask";
  title: string;
  lead: string;
  goal?: number; // goal in dollars (for kind=raise)
  raised: number;
  count: number;
}

export interface DonateInput {
  handle: string;
  amount: number;
  name?: string;
  message?: string;
  slug?: string; // set when donating on a campaign page — only that campaign's total is bumped
  source?: GameId | "direct"; // which mini-game settled this money; defaults to a plain donation
  /**
   * An SPL-memo to ride along with the donation. Only the roulette uses it: a
   * stake is an ordinary donation plus a memo binding it to `(round, variant)`,
   * and that binding has to be ON CHAIN or the wheel would be only as honest as
   * this app. Everything else about the donation is unchanged, which is why this
   * is a parameter here rather than a second donation path.
   */
  memo?: string;
}

// A block on the streamer's public page that can be toggled on/off and reordered.
export interface PageWidget {
  kind: "donate" | "socials";
  enabled: boolean;
}

export interface PageBackground {
  type: "color" | "gradient" | "image";
  value: string; // hex for "color", "from|to" for "gradient", URL/data URL for "image"
  // Image only — how the photo sits (a portrait photo can't fill both a phone and a desktop cleanly,
  // so the streamer picks). Defaults to "cover" for anything saved before this existed.
  //   cover — fill the screen, fixed in place (a vertical slice shows on wide desktops)
  //   width — the whole photo, full-width at the top; page colour below
  //   split — two photos: `value` on phones, `valueWide` on desktops
  fit?: "cover" | "width" | "split";
  valueWide?: string; // image "split" mode: the desktop photo
  // Gradient only — how the two colours are laid out. Defaults keep old gradients working.
  gradAngle?: number; // direction in degrees, 0-360 (default 160)
  gradPos?: number; // where the colours meet, 0-100 (default 50 = centred)
  gradSoft?: number; // blend width, 0-100 (0 = a hard flag edge, 100 = a smooth fade)
}

export interface PageDesign {
  background: PageBackground;
}

// Rules for the "Task for donation" game — the streamer's own limits on what they're on the
// hook for. Not on-chain: the contract only knows amount + deadline + outcome (front.md I §4);
// these are front-end guardrails the streamer sets for themselves before the game goes live.
export interface TaskGameConfig {
  minAmount: number; // $ — a task can't be submitted for less than this
  deadlineHours: number; // hours the streamer has to finish it before a refund can be claimed
  requireApproval: boolean; // streamer must accept the task before the deadline clock starts
  maxActiveTasks: number; // queue cap — new tasks pause once this many are in progress
}

// Rules for the Roulette game — viewers suggest a game to play by donating toward it; a
// weighted spin picks one (pool share = odds). These are the streamer's guardrails on who's
// allowed to suggest what, and how long a round runs. Not on-chain — a suggestion is just a
// plain donation (front.md I §5); the spin itself is a front-end/backend concern, not a contract.
export interface RouletteConfig {
  minTier: string; // tier name required to suggest, "" = everyone can
  excludeTopTier: boolean; // if true, the streamer's highest tier can't suggest (e.g. they get asked directly instead)
  // What the wheel is ABOUT. The roulette isn't games-only — see lib/data/roulette-topics.ts for the
  // ready-made topics (films, music, food, challenges, talk topics, creative work…). Absent on configs
  // saved before topics existed; those read as "games", which is what they were.
  topic?: string; // topic id
  customCategories?: string[]; // the streamer's own categories, on top of (or instead of) the topic's
  // How the wheel decides. "single" — one spin picks the winner. "elimination" — the wheel spins over
  // and over, each spin knocking one out, last one standing wins (money protects: a well-backed
  // suggestion is the least likely to be eliminated). Absent = single, which is what old rounds were.
  format?: "single" | "elimination";
  genres: string[]; // allowed categories for a suggestion, empty = all of them allowed
  minDonation: number; // $ — a suggestion needs at least this much to register
  roundMinutes: number; // how long the submission window stays open before the spin
  playMinutes: number; // how long the streamer commits to the winning pick
}

// The Fundraiser page itself — the promise viewers are chipping in toward, plus everything
// the streamer arranges on that page (same builder pattern as the Task page). One active
// fundraiser per streamer for now; on-chain each one becomes its own collection of escrows.
export interface FundraiserDraft {
  pledge: string; // headline — what the streamer commits to do if the goal is met
  description: string; // longer text under the pledge (details, terms, why)
  descriptionEnabled: boolean;
  goal: number; // $ target
  presets: number[]; // chip-in amount chips, at least 1
  widgets: PageWidget[]; // chip-in form + socials — toggle/reorder, same shape as the main page
  design: PageDesign; // the fundraiser page's own backdrop
  fillImage?: string; // data URL — the content maker's own photo for the fill-up figure; empty = Cheer badge
}

// The Task page itself — what a viewer sees when they open the link to set a paid task.
// Same builder shape as the Fundraiser and Roulette drafts; the queue of real tasks is live
// data (lib/data/tasks.ts), not part of the draft.
export interface TaskDraft {
  headline: string; // the pitch — what you're taking tasks for
  description: string; // longer text under it (what you'll do, what you won't)
  descriptionEnabled: boolean;
  presets: number[]; // task amount chips, at least 1
  widgets: PageWidget[]; // task form + socials — toggle/reorder, same shape as the main page
  design: PageDesign; // the task page's own backdrop
}

// The Roulette page itself — what viewers see when they open the round: the streamer's own
// pitch plus the page furniture (same builder pattern as the Task and Fundraiser pages).
// The round's suggestions/pools are live data, not part of the draft.
export interface RouletteDraft {
  headline: string; // the streamer's pitch — what this wheel is about
  description: string; // longer text under the headline (house rules, schedule)
  descriptionEnabled: boolean;
  presets: number[]; // suggestion amount chips, at least 1
  widgets: PageWidget[]; // suggest form + socials — toggle/reorder, same shape as the main page
  design: PageDesign; // the roulette page's own backdrop
}

// Rules for the Fundraiser game — the streamer's standing guardrails, applied to every
// fundraiser they open. Not on-chain: the contracts only know amounts, deadlines and the
// verdict; these keep the collection sane (e.g. dust contributions cost more gas to claim
// than they're worth).
export interface FundraiserConfig {
  minContribution: number; // $ — a contribution below this doesn't register
  fundingDays: number; // how long the collection stays open
  deliveryDays: number; // window to deliver after accepting the amount
  allowBelowGoal: boolean; // streamer may accept a partially funded goal
  minAcceptPct: number; // % of the goal required to accept when allowBelowGoal is on
}



// Streamer profile (localStorage — the "mock backend"). widgets/design/avatar* are optional so
// profiles saved before the page builder shipped still load — see lib/data/pagebuilder.ts defaults.
export interface Profile {
  handle: string;
  name: string;
  bio?: string; // the "about" line on the public page (Settings edits it)
  bioEnabled?: boolean; // whether it's shown
  address: string; // base58 Solana pubkey, or "" until the wallet step sets one
  socials: Social[];
  tiers: Tier[];
  avatarEnabled?: boolean;
  avatarUrl?: string; // data URL, mock upload
  widgets?: PageWidget[];
  design?: PageDesign;
  task?: string; // legacy: the old author-page builder's task line — TaskDraft.headline supersedes it
  taskPage?: TaskDraft; // the Task game's own public page — see TaskDraft
  donatePresets?: number[]; // the donate widget's amount chips — streamer can add/remove, at least 1
  taskConfig?: TaskGameConfig; // rules for the Task for donation game — see TaskGameConfig
  rouletteConfig?: RouletteConfig; // rules for the Roulette game — see RouletteConfig
  roulette?: RouletteDraft; // the Roulette page — see RouletteDraft
  fundraiser?: FundraiserDraft; // the active Fundraiser page — see FundraiserDraft
  fundraiserConfig?: FundraiserConfig; // rules for the Fundraiser game — see FundraiserConfig
}
