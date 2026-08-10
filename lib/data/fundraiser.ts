// Fundraiser data helpers — defaults and the localStorage mock of "how much is collected",
// mirroring lib/data/pagebuilder.ts for the main page builder. Data only, no React.

import type { FundraiserDraft, PageWidget, Profile } from "./types";
import { isFreshScope } from "./freshScope";
import { DEFAULT_DESIGN } from "./pagebuilder";
import { sendOp } from "./gameSync";

export const PLEDGE_MAX = 140;
export const FR_DESCRIPTION_MAX = 300;
export const MAX_FR_PRESETS = 6;

export const DEFAULT_FR_WIDGETS: PageWidget[] = [
  { kind: "donate", enabled: true },
  { kind: "socials", enabled: true },
];

export const DEFAULT_FR_PRESETS: number[] = [5, 25, 100];

export const DEFAULT_FUNDRAISER: FundraiserDraft = {
  pledge: "",
  description: "",
  descriptionEnabled: true,
  goal: 1000,
  presets: DEFAULT_FR_PRESETS,
  widgets: DEFAULT_FR_WIDGETS,
  design: DEFAULT_DESIGN,
};

// Back-fills drafts saved before the fundraiser builder grew widgets/design/presets,
// so they render with sane defaults instead of undefined (same idea as withPageDefaults).
export function withFundraiserDefaults(profile: Profile): FundraiserDraft {
  const fr = profile.fundraiser;
  return {
    ...DEFAULT_FUNDRAISER,
    ...fr,
    presets: fr?.presets?.length ? fr.presets : DEFAULT_FR_PRESETS,
    widgets: fr?.widgets?.length ? fr.widgets : DEFAULT_FR_WIDGETS,
    design: fr?.design ?? DEFAULT_DESIGN,
  };
}

// ---- mock "collected so far" (localStorage, like the rest of the mock backend) ----
// The real number will come from the escrow set via the indexer; until then chip-ins on the
// public page accumulate here so the cheer actually fills up when you try it.

const COLLECTED_KEY = "cheer-fundraiser-collected";

export function readCollected(handle: string): number {
  try {
    const raw = localStorage.getItem(`${COLLECTED_KEY}:${handle}`);
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function addCollected(handle: string, amount: number): number {
  const next = readCollected(handle) + Math.max(0, amount);
  try {
    localStorage.setItem(`${COLLECTED_KEY}:${handle}`, String(next));
  } catch {}
  // Share it as a DELTA: concurrent chip-ins from different browsers must sum.
  sendOp(handle, "cheer-fundraiser-collected", { type: "add", delta: Math.max(0, amount) });
  return next;
}

// ---- contributions: the escrows this collection is actually made of ----
//
// A collection is N escrows, one per chip-in, and settling it means claiming
// every one of them. The running total above cannot do that: it is a number, and
// a claim needs an address, a donor and the exact birth fields the escrow was
// derived from. So each contribution is recorded here as it is born.
//
// Shared like the task queue is, and for the same reason: the person who settles
// (or refunds) is the creator, in a different browser from every donor.

export interface Contribution {
  id: string; // the escrow address — unique by construction
  escrow: string;
  donor: string;
  amount: number; // dollars, for the UI
  when: string;
  // Unix seconds. Past it this contribution refunds to its donor with no verdict
  // and no signature — the escape hatch a silent resolver leaves intact.
  deadline?: number;
}

const CONTRIB_KEY = "cheer-fundraiser-contributions";

export function readContributions(handle: string): Contribution[] {
  try {
    const raw = localStorage.getItem(`${CONTRIB_KEY}:${handle}`);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function addContribution(handle: string, c: Omit<Contribution, "id" | "when">): Contribution[] {
  const item: Contribution = { ...c, id: c.escrow, when: "just now" };
  const next = [item, ...readContributions(handle).filter((x) => x.id !== item.id)];
  try {
    localStorage.setItem(`${CONTRIB_KEY}:${handle}`, JSON.stringify(next));
  } catch {}
  // `append` dedups by id, and the id IS the escrow address — two browsers
  // recording the same contribution converge instead of double-counting it.
  sendOp(handle, CONTRIB_KEY, { type: "append", item: item as unknown as { id: string } & Record<string, unknown> });
  return next;
}

// ---- campaign state + backers ----
// The public page only tracks a running total (readCollected); the cabinet's Overview also needs
// individual backers to show, and where the campaign is in its lifecycle. Both are mocked here —
// the real ones come from the escrow set + its verdict later.

export type FundraiserState = "collecting" | "delivering" | "delivered" | "refunded";

export interface FundraiserStatus {
  state: FundraiserState;
  accepted?: number; // the amount locked in when you accept and move to delivering
  chainCollection?: string; // hex collection id once the streamer opened it on the funding canister
}

export interface Backer {
  name: string;
  amount: number; // $ this backer has in escrow
  when: string; // human-readable, like the donations feed
}

// Seed backers — sums to $720, so against the default $1,000 goal the campaign sits ~72%:
// past a 50% accept threshold, short of the full goal. A good state to demo the Accept decision.

// Raised = what has actually been chipped in on this collection.
export function raisedTotal(handle: string): number {
  return readCollected(handle);
}

// Backers list that adds up to raisedTotal — one row per contribution actually
// recorded on this collection. On-chain contributions carry their donor wallet;
// anything collected before the chain path was live shows as one summary row so
// the list still adds up to the total on screen.
export function readBackers(handle: string): Backer[] {
  const contributions = readContributions(handle);
  const named = contributions.map((c) => ({
    name: `${c.donor.slice(0, 4)}…${c.donor.slice(-4)}`,
    amount: c.amount,
    when: c.when,
  }));
  const accounted = contributions.reduce((sum, c) => sum + c.amount, 0);
  const rest = readCollected(handle) - accounted;
  return rest > 0.005 ? [...named, { name: "Chipped in", amount: rest, when: "" }] : named;
}

const STATUS_KEY = "cheer-fundraiser-status";
const FUNDRAISER_STATES: FundraiserState[] = ["collecting", "delivering", "delivered", "refunded"];

export function readStatus(handle: string): FundraiserStatus {
  try {
    const raw = localStorage.getItem(`${STATUS_KEY}:${handle}`);
    if (raw) {
      const s = JSON.parse(raw);
      // Only accept a known state — an unrecognised value (corruption/tamper) would otherwise
      // persist and wedge the campaign, since no UI transition can leave an off-enum state.
      if (s && FUNDRAISER_STATES.includes(s.state)) return { state: s.state, accepted: s.accepted, chainCollection: s.chainCollection };
    }
  } catch {}
  return { state: "collecting" };
}

export function writeStatus(handle: string, status: FundraiserStatus): FundraiserStatus {
  try {
    localStorage.setItem(`${STATUS_KEY}:${handle}`, JSON.stringify(status));
  } catch {}
  // Single-writer key (the streamer's accept/deliver/refund) — authoritative overwrite.
  sendOp(handle, "cheer-fundraiser-status", { type: "replace", value: status });
  return status;
}
