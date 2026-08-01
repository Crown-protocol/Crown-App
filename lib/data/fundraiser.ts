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
// public page accumulate here so the crown actually fills up when you try it.

const COLLECTED_KEY = "crown-fundraiser-collected";

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
  sendOp(handle, "crown-fundraiser-collected", { type: "add", delta: Math.max(0, amount) });
  return next;
}

// ---- campaign state + backers (mock) ----
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
export const MOCK_BACKERS: Backer[] = [
  { name: "Timur", amount: 250, when: "2h ago" },
  { name: "anna_k", amount: 100, when: "5h ago" },
  { name: "Max", amount: 200, when: "Yesterday" },
  { name: "lena", amount: 90, when: "Yesterday" },
  { name: "Dan", amount: 80, when: "2 days ago" },
];

const MOCK_BACKERS_TOTAL = MOCK_BACKERS.reduce((sum, b) => sum + b.amount, 0);

// Raised = the seeded backers plus any real chip-ins made on the public page while testing.
export function raisedTotal(handle: string): number {
  // A fresh session starts at zero — the seeded backers belong to the first scope only.
  return (isFreshScope(handle) ? 0 : MOCK_BACKERS_TOTAL) + readCollected(handle);
}

// Backers list that adds up to raisedTotal: the seed, plus a single row for test chip-ins.
export function readBackers(handle: string): Backer[] {
  const list = isFreshScope(handle) ? [] : MOCK_BACKERS.map((b) => ({ ...b }));
  const collected = readCollected(handle);
  if (collected > 0) list.unshift({ name: "Your test chip-ins", amount: collected, when: "just now" });
  return list;
}

const STATUS_KEY = "crown-fundraiser-status";
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
  sendOp(handle, "crown-fundraiser-status", { type: "replace", value: status });
  return status;
}
