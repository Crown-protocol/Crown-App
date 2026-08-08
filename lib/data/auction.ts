// Auction game — the public page's draft, the lot book, and the localStorage mock behind both.
// Data + store, no React. Mirrors lib/data/roulette.ts / tasks.ts. The real book will come from
// the auction canister (cheer-games/auction, game-spec.md); until then lots placed on the public
// page really do land in the streamer's Auction → Overview, and both pages share one store.
//
// The game in one line: viewers place lots (money in escrow + a condition text private to the
// streamer), the streamer accepts the ones they're willing to do, anyone tops up accepted lots,
// the richest accepted lot wins at the bell — losers are refunded instantly, and the winner pays
// out only after the streamer delivers and reputation holders confirm.

import type { AuctionDraft, PageWidget, Profile } from "./types";
import { isFreshScope } from "./freshScope";
import { sendOp } from "./gameSync";
import { DEFAULT_DESIGN } from "./pagebuilder";

export const AU_HEADLINE_MAX = 140;
export const AU_DESCRIPTION_MAX = 300;
export const MAX_AU_PRESETS = 6;

export const DEFAULT_AU_WIDGETS: PageWidget[] = [
  { kind: "donate", enabled: true },
  { kind: "socials", enabled: true },
];

export const DEFAULT_AU_PRESETS: number[] = [10, 25, 50];

export const DEFAULT_AUCTION: AuctionDraft = {
  headline: "",
  description: "",
  descriptionEnabled: true,
  presets: DEFAULT_AU_PRESETS,
  widgets: DEFAULT_AU_WIDGETS,
  design: DEFAULT_DESIGN,
};

// Back-fills drafts saved before the auction builder existed (same idea as withPageDefaults).
export function withAuctionDefaults(profile: Profile): AuctionDraft {
  const au = profile.auction;
  return {
    ...DEFAULT_AUCTION,
    ...au,
    presets: au?.presets?.length ? au.presets : DEFAULT_AU_PRESETS,
    widgets: au?.widgets?.length ? au.widgets : DEFAULT_AU_WIDGETS,
    design: au?.design ?? DEFAULT_DESIGN,
  };
}

// ---- the lot book (localStorage, like the rest of the mock backend) ----

// pending — placed, text visible to the streamer only, not in the bidding yet.
// accepted — streamer took it: text public, open for top-ups, competes at the bell.
// returned — streamer (or operator) sent the money back; out of the bidding.
export type LotState = "pending" | "accepted" | "returned";

export interface LotEntry {
  name: string;
  amount: number; // $ this backer has in escrow on this lot
  when: string; // human-readable, like the donations feed
}

export interface AuctionLot {
  id: string;
  from: string; // who placed it
  text: string; // the condition — private until the lot is accepted
  state: LotState;
  entries: LotEntry[]; // the placer's own escrow first, then top-ups
  when: string;
  chainLot?: string; // hex lot_id (sha256(auction_id ‖ text_hash)) when born on-chain
  escrow?: string; // base58 escrow address of the placer's own entry
}

export function lotSum(lot: AuctionLot): number {
  return lot.entries.reduce((s, e) => s + e.amount, 0);
}

// Seed book — one of each situation: a rich leader with top-ups, a challenger, a fresh private
// lot awaiting the streamer, and a returned one. Newest first.
export const MOCK_LOTS: AuctionLot[] = [
  {
    id: "l1",
    from: "Timur",
    text: "Finish the map on the hardest difficulty — no saves.",
    state: "accepted",
    entries: [
      { name: "Timur", amount: 60, when: "2h ago" },
      { name: "mira.eth", amount: 45, when: "1h ago" },
      { name: "Dan", amount: 15, when: "30 min ago" },
    ],
    when: "2h ago",
  },
  {
    id: "l2",
    from: "anna_k",
    text: "Full playthrough with your cam upside down.",
    state: "accepted",
    entries: [{ name: "anna_k", amount: 85, when: "1h ago" }],
    when: "1h ago",
  },
  {
    id: "l3",
    from: "guest_17",
    text: "Sing the outro of every match you lose today.",
    state: "pending",
    entries: [{ name: "guest_17", amount: 25, when: "12 min ago" }],
    when: "12 min ago",
  },
  {
    id: "l4",
    from: "n0va",
    text: "Uninstall your main game on stream.",
    state: "returned",
    entries: [{ name: "n0va", amount: 200, when: "3h ago" }],
    when: "3h ago",
  },
];

const LOTS_KEY = "cheer-auction-lots";

export function readLots(handle: string): AuctionLot[] {
  try {
    const raw = localStorage.getItem(`${LOTS_KEY}:${handle}`);
    if (raw) {
      const list = JSON.parse(raw);
      if (Array.isArray(list)) return list;
    }
  } catch {}
  // First visit: start from the seed — unless this scope is a fresh session, which starts empty.
  if (isFreshScope(handle)) return [];
  return MOCK_LOTS.map((l) => ({ ...l, entries: l.entries.map((e) => ({ ...e })) }));
}

function writeLots(handle: string, list: AuctionLot[]) {
  try {
    localStorage.setItem(`${LOTS_KEY}:${handle}`, JSON.stringify(list));
  } catch {}
}

// A viewer places a new lot from the public page — lands private-to-the-streamer.
export function addLot(handle: string, input: { from: string; amount: number; text: string; chainLot?: string; escrow?: string }): AuctionLot[] {
  const from = input.from.trim() || "Anonymous";
  const lot: AuctionLot = {
    id: `l-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    from,
    text: input.text.trim(),
    state: "pending",
    entries: [{ name: from, amount: input.amount, when: "just now" }],
    when: "just now",
    ...(input.chainLot ? { chainLot: input.chainLot } : {}),
    ...(input.escrow ? { escrow: input.escrow } : {}),
  };
  const next = [lot, ...readLots(handle)];
  writeLots(handle, next);
  // Share it: append commutes with other viewers' lots; `seed` initialises the
  // server copy with the demo rows on the very first real action in a scope.
  sendOp(handle, "cheer-auction-lots", { type: "append", item: lot as unknown as { id: string } & Record<string, unknown>, seed: next });
  return next;
}

// Anyone joins an accepted lot with their own escrow — the lot climbs the board.
export function topUpLot(handle: string, id: string, input: { name: string; amount: number }): AuctionLot[] {
  const entry = { name: input.name.trim() || "Anonymous", amount: input.amount, when: "just now" };
  const current = readLots(handle);
  const next = current.map((l) => (l.id === id && l.state === "accepted" ? { ...l, entries: [...l.entries, entry] } : l));
  writeLots(handle, next);
  // Share it as an ENTRY append on that one lot — concurrent top-ups both count. `seed` carries the
  // board this entry was applied to: on a demo scope readLots() hands back MOCK_LOTS from memory, and
  // without the seed the server would hold an entry for a lot it has never heard of.
  sendOp(handle, "cheer-auction-lots", { type: "entry", id, entry, seed: next as unknown as Record<string, unknown>[] });
  return next;
}

// Accept (text goes public, lot competes) or return (money goes back) — the streamer's two calls.
export function setLotState(handle: string, id: string, state: LotState): AuctionLot[] {
  const next = readLots(handle).map((l) => (l.id === id ? { ...l, state } : l));
  writeLots(handle, next);
  // The streamer is the book's single authority — accept/return overwrites.
  sendOp(handle, "cheer-auction-lots", { type: "replace", value: next });
  return next;
}

// Accepted lots, richest first — the leaderboard both pages show.
export function leaderboard(list: AuctionLot[]): AuctionLot[] {
  return list.filter((l) => l.state === "accepted").sort((a, b) => lotSum(b) - lotSum(a));
}

export function auctionTotals(list: AuctionLot[]) {
  const accepted = leaderboard(list);
  return {
    pending: list.filter((l) => l.state === "pending").length,
    accepted: accepted.length,
    pot: accepted.reduce((s, l) => s + lotSum(l), 0),
    top: accepted[0] ?? null,
  };
}

// ---- auction lifecycle (mock) ----
// The clock starts when the auction is first seen; the streamer can close the bidding early
// (the maker's call) — same pattern as the roulette round. The verdict chain is the spec's:
// bidding → performing (winner delivers) → voting (reputation holders confirm) → settled/refunded.

// The platform floor — set by the admin, not the streamer: no auction anywhere may open below
// this. Mirrors the escrow form's own floor; the real value will come from the platform config.
export const PLATFORM_MIN_BID = 1;

export type AuctionState = "bidding" | "performing" | "voting" | "settled" | "refunded" | "cancelled";

export interface AuctionMeta {
  startedAt: number; // epoch ms — the bidding clock's zero
  state: AuctionState;
  chainAuction?: string; // hex auction id once created on the auction canister
  minBid?: number; // the opening price, fixed at creation (spec: the maker's call, set once, forever)
  winnerId: string | null; // set at the final
  votes: { done: number; notDone: number; voters: string[] }; // weights in $ of reputation (mock: 1 voter = their stated weight)
}

const META_KEY = "cheer-auction-meta";

const FRESH_META = (): AuctionMeta => ({ startedAt: Date.now(), state: "bidding", winnerId: null, votes: { done: 0, notDone: 0, voters: [] } });

export function readAuctionMeta(handle: string): AuctionMeta | null {
  try {
    const raw = localStorage.getItem(`${META_KEY}:${handle}`);
    if (!raw) return null;
    const m = JSON.parse(raw);
    if (typeof m?.startedAt !== "number") return null;
    return { ...FRESH_META(), ...m, votes: { done: 0, notDone: 0, voters: [], ...(m.votes ?? {}) }, startedAt: m.startedAt };
  } catch {
    return null;
  }
}

function writeMeta(handle: string, meta: AuctionMeta, share = true) {
  try {
    localStorage.setItem(`${META_KEY}:${handle}`, JSON.stringify(meta));
  } catch {}
  // Authoritative writes (init/bell/votes/new auction) overwrite the shared copy. ensureAuction's
  // first-sight default passes share=false — a fresh viewer's local clock must never reset the
  // bidding for everyone; the next poll adopts the real shared meta if one exists.
  if (share) sendOp(handle, "cheer-auction-meta", { type: "replace", value: meta });
}

export function ensureAuction(handle: string): AuctionMeta {
  const meta = readAuctionMeta(handle);
  if (meta) return meta;
  const fresh = FRESH_META();
  writeMeta(handle, fresh, false);
  return fresh;
}

// Attach the canister-born auction id (kept on the synced meta, so every browser sees it).
export function setAuctionChain(handle: string, chainAuction: string): AuctionMeta {
  const next: AuctionMeta = { ...ensureAuction(handle), chainAuction };
  writeMeta(handle, next);
  return next;
}

// Open an auction with its price floor — called when the session is created. The floor is
// clamped to the platform minimum: the admin's number is the one nobody goes under.
export function initAuction(handle: string, minBid: number): AuctionMeta {
  const fresh: AuctionMeta = { ...FRESH_META(), minBid: Math.max(PLATFORM_MIN_BID, Math.round(minBid) || PLATFORM_MIN_BID) };
  writeMeta(handle, fresh);
  return fresh;
}

// The bell: richest accepted lot wins, everyone else is refunded instantly (state stays on the
// lots; the meta's winnerId is what marks the survivor). No winner → the auction just dies.
export function closeBidding(handle: string): AuctionMeta {
  const meta = ensureAuction(handle);
  if (meta.state !== "bidding") return meta;
  const top = leaderboard(readLots(handle))[0];
  const next: AuctionMeta = top
    ? { ...meta, state: "performing", winnerId: top.id }
    : { ...meta, state: "cancelled", winnerId: null };
  writeMeta(handle, next);
  return next;
}

// "Done" — the streamer claims delivery; the community takes over.
export function markReady(handle: string): AuctionMeta {
  const meta = ensureAuction(handle);
  if (meta.state !== "performing") return meta;
  const next: AuctionMeta = { ...meta, state: "voting" };
  writeMeta(handle, next);
  return next;
}

// One vote per name; weight is the voter's reputation with this streamer (mock: passed in).
export function castVote(handle: string, input: { name: string; weight: number; choice: "done" | "not_done" }): AuctionMeta {
  const meta = ensureAuction(handle);
  const name = input.name.trim() || "anon";
  if (meta.state !== "voting" || meta.votes.voters.includes(name)) return meta;
  const votes = {
    done: meta.votes.done + (input.choice === "done" ? input.weight : 0),
    notDone: meta.votes.notDone + (input.choice === "not_done" ? input.weight : 0),
    voters: [...meta.votes.voters, name],
  };
  const next: AuctionMeta = { ...meta, votes };
  writeMeta(handle, next);
  return next;
}

// The count: strictly more "done" weight settles; ties, silence and everything else refunds —
// silence from the community must not move other people's money (spec §10).
export function closeVoting(handle: string): AuctionMeta {
  const meta = ensureAuction(handle);
  if (meta.state !== "voting") return meta;
  const next: AuctionMeta = { ...meta, state: meta.votes.done > meta.votes.notDone ? "settled" : "refunded" };
  writeMeta(handle, next);
  return next;
}

// The maker's own cancel — only while bidding (spec §5); everything goes back.
export function cancelAuction(handle: string): AuctionMeta {
  const meta = ensureAuction(handle);
  if (meta.state !== "bidding") return meta;
  const next: AuctionMeta = { ...meta, state: "cancelled", winnerId: null };
  writeMeta(handle, next);
  return next;
}

// Fresh auction: clears the book and restarts the clock.
export function newAuction(handle: string): AuctionMeta {
  try {
    localStorage.removeItem(`${LOTS_KEY}:${handle}`);
  } catch {}
  sendOp(handle, "cheer-auction-lots", { type: "replace", value: [] });
  const fresh = FRESH_META();
  writeMeta(handle, fresh);
  return fresh;
}

// ---- finished-auction history (mock) ----

export interface AuctionRecord {
  id: string;
  date: string;
  condition: string; // the winning lot's text (or why it ended without one)
  pot: number; // the winning lot's sum
  lots: number; // accepted lots that competed
  verdict: "paid out" | "refunded" | "cancelled";
}

export const MOCK_AUCTION_HISTORY: AuctionRecord[] = [
  { id: "a-h1", date: "Jul 12, 2026", condition: "Speedrun the first act under 40 minutes.", pot: 180, lots: 4, verdict: "paid out" },
  { id: "a-h2", date: "Jul 6, 2026", condition: "Whole stream in a medieval accent.", pot: 95, lots: 2, verdict: "paid out" },
  { id: "a-h3", date: "Jun 29, 2026", condition: "Beat a viewer 1v1, loser deletes a rank.", pot: 240, lots: 5, verdict: "refunded" },
];

const HISTORY_KEY = "cheer-auction-history";

function readLocalHistory(handle: string): AuctionRecord[] {
  try {
    const raw = localStorage.getItem(`${HISTORY_KEY}:${handle}`);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function readAuctionHistory(handle: string): AuctionRecord[] {
  return [...readLocalHistory(handle), ...MOCK_AUCTION_HISTORY];
}

export function appendAuctionHistory(handle: string, entry: AuctionRecord): AuctionRecord[] {
  const next = [entry, ...readLocalHistory(handle)].slice(0, 50);
  try {
    localStorage.setItem(`${HISTORY_KEY}:${handle}`, JSON.stringify(next));
  } catch {}
  return next;
}
