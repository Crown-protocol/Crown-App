import { Actor, HttpAgent, type ActorSubclass } from "@dfinity/agent";
import { IDL } from "@dfinity/candid";
import {
  CHAIN_ID,
  IC_HOST,
  TASKS_PRINCIPAL,
  FUNDING_PRINCIPAL,
  AUCTION_PRINCIPAL,
  SUBSCRIPTION_PRINCIPAL,
} from "./config";

// ──────────────────────────────────────────────────────────────────
// The four game canisters (Conditional-Tasks, Conditional-Funding, Auction,
// Subscription) — hand-written Candid actors pinned to each repo's frozen
// .did, plus the participant messages wallets sign (UTF-8 text, the exact
// byte formats the canisters' auth.rs unit-tests pin).
//
// None of the canisters have public principals yet (S4 deferred): every
// actor() below returns null until NEXT_PUBLIC_IC_HOST + the game's
// principal are set, and the game UIs keep running on their mock stores.
// The moment the env lands, this layer is the only doorway the UIs need.
// ──────────────────────────────────────────────────────────────────

async function agent(): Promise<HttpAgent | null> {
  if (!IC_HOST) return null;
  const a = await HttpAgent.create({ host: IC_HOST });
  if (/localhost|127\.0\.0\.1/.test(IC_HOST)) await a.fetchRootKey();
  return a;
}

async function makeActor<T>(principal: string, idl: IDL.InterfaceFactory): Promise<ActorSubclass<T> | null> {
  if (!principal) return null;
  const ag = await agent();
  if (!ag) return null;
  return Actor.createActor<T>(idl, { agent: ag, canisterId: principal });
}

// ---- participant messages ----------------------------------------------
// One field per line, fixed order, closed vocabulary — the canisters verify
// the wallet's Ed25519 signature over EXACTLY these bytes (game-spec §4/§5/§6).
// Wallets show them as readable text (the Phantom constraint).
//
// Every canonical message ENDS with a newline: the canisters' auth.rs builders
// push '\n' after every line including the last, and their pinned unit-test
// vectors end in `\n"` — a message without the trailing newline fails
// signature verification byte-for-byte.

const nl = (lines: string[]) => lines.join("\n") + "\n";

export const taskMessage = {
  register: (canister: string, task: string, textHex: string, duration: number) =>
    nl([`crown:conditional-tasks:v1`, `action: register`, `chain: ${CHAIN_ID}`, `canister: ${canister}`, `task: ${task}`, `text: ${textHex}`, `duration: ${duration}`]),
  action: (action: "accept" | "decline" | "ready", canister: string, task: string) =>
    nl([`crown:conditional-tasks:v1`, `action: ${action}`, `chain: ${CHAIN_ID}`, `canister: ${canister}`, `task: ${task}`]),
  vote: (canister: string, task: string, choice: "done" | "not_done") =>
    nl([`crown:conditional-tasks:v1`, `action: vote`, `chain: ${CHAIN_ID}`, `canister: ${canister}`, `task: ${task}`, `choice: ${choice}`]),
};

export const fundingMessage = {
  // The canonical builder pushes `collection:` UNCONDITIONALLY — create included: the id is
  // derived (deriveCollectionId) before the canister call, so the recipient signs over it too.
  create: (canister: string, collectionHex: string, goal: number, duration: number) =>
    nl([`crown:conditional-funding:v1`, `action: create`, `chain: ${CHAIN_ID}`, `canister: ${canister}`, `collection: ${collectionHex}`, `goal: ${goal}`, `duration: ${duration}`]),
  action: (action: "ready" | "recipient_cancel", canister: string, collectionHex: string) =>
    nl([`crown:conditional-funding:v1`, `action: ${action}`, `chain: ${CHAIN_ID}`, `canister: ${canister}`, `collection: ${collectionHex}`]),
  vote: (canister: string, collectionHex: string, choice: "done" | "not_done") =>
    nl([`crown:conditional-funding:v1`, `action: vote`, `chain: ${CHAIN_ID}`, `canister: ${canister}`, `collection: ${collectionHex}`, `choice: ${choice}`]),
};

export const auctionMessage = {
  create: (canister: string, nonce: number, duration: number, performWindow: number, minEntry: number) =>
    nl([`crown:auction:v1`, `action: create`, `chain: ${CHAIN_ID}`, `canister: ${canister}`, `recipient_nonce: ${nonce}`, `duration: ${duration}`, `perform_window: ${performWindow}`, `min_entry: ${minEntry}`]),
  lot: (action: "accept" | "return-lot", canister: string, auctionHex: string, lotHex: string) =>
    nl([`crown:auction:v1`, `action: ${action}`, `chain: ${CHAIN_ID}`, `canister: ${canister}`, `auction: ${auctionHex}`, `lot: ${lotHex}`]),
  entry: (canister: string, auctionHex: string, escrowB58: string) =>
    nl([`crown:auction:v1`, `action: return-entry`, `chain: ${CHAIN_ID}`, `canister: ${canister}`, `auction: ${auctionHex}`, `escrow: ${escrowB58}`]),
  auction: (action: "cancel" | "ready", canister: string, auctionHex: string) =>
    nl([`crown:auction:v1`, `action: ${action}`, `chain: ${CHAIN_ID}`, `canister: ${canister}`, `auction: ${auctionHex}`]),
  vote: (canister: string, auctionHex: string, choice: "done" | "not_done") =>
    nl([`crown:auction:v1`, `action: vote`, `chain: ${CHAIN_ID}`, `canister: ${canister}`, `auction: ${auctionHex}`, `choice: ${choice}`]),
};

export const subscriptionMessage = {
  cancel: (canister: string, escrowB58: string) =>
    nl([`crown:subscription:v1`, `action: cancel`, `chain: ${CHAIN_ID}`, `canister: ${canister}`, `escrow: ${escrowB58}`]),
};

// ---- Conditional-Tasks --------------------------------------------------

const Outcome = IDL.Variant({ settle: IDL.Null, cancel: IDL.Null });
const Choice = IDL.Variant({ done: IDL.Null, not_done: IDL.Null });
const Vote = IDL.Record({ voter: IDL.Vec(IDL.Nat8), choice: Choice, weight: IDL.Nat });

export interface TasksCanister {
  register_task: (arg: {
    chain: string; donor: Uint8Array; recipient: Uint8Array; gross: bigint; deadline: bigint;
    resolver: Uint8Array; nonce: bigint; duration: bigint; text_hash: Uint8Array; signature: Uint8Array;
  }) => Promise<{ Ok: Uint8Array } | { Err: string }>;
  accept: (arg: TaskAction) => Promise<{ Ok: null } | { Err: string }>;
  decline: (arg: TaskAction) => Promise<{ Ok: null } | { Err: string }>;
  ready: (arg: TaskAction) => Promise<{ Ok: null } | { Err: string }>;
  vote: (arg: { chain: string; task_id: Uint8Array; voter: Uint8Array; choice: { done: null } | { not_done: null }; signature: Uint8Array }) => Promise<{ Ok: null } | { Err: string }>;
  get_task: (chain: string, taskId: Uint8Array) => Promise<[] | [{ data: Uint8Array; certificate: [] | [Uint8Array]; witness: Uint8Array }]>;
  list_tasks: (chain: string, recipient: Uint8Array) => Promise<Uint8Array[]>;
  get_resolver: (chain: string) => Promise<[] | [Uint8Array]>;
  get_verdict: (chain: string, taskId: Uint8Array) => Promise<[] | [{ outcome: { settle: null } | { cancel: null }; signature: [] | [Uint8Array] }]>;
}
interface TaskAction { chain: string; task_id: Uint8Array; signature: Uint8Array }

const tasksIdl: IDL.InterfaceFactory = ({ IDL: I }) => {
  const ActionArg = I.Record({ chain: I.Text, task_id: I.Vec(I.Nat8), signature: I.Vec(I.Nat8) });
  const ActionResult = I.Variant({ Ok: I.Null, Err: I.Text });
  return I.Service({
    register_task: I.Func([I.Record({
      chain: I.Text, donor: I.Vec(I.Nat8), recipient: I.Vec(I.Nat8), gross: I.Nat64, deadline: I.Nat64,
      resolver: I.Vec(I.Nat8), nonce: I.Nat64, duration: I.Nat64, text_hash: I.Vec(I.Nat8), signature: I.Vec(I.Nat8),
    })], [I.Variant({ Ok: I.Vec(I.Nat8), Err: I.Text })], []),
    accept: I.Func([ActionArg], [ActionResult], []),
    decline: I.Func([ActionArg], [ActionResult], []),
    ready: I.Func([ActionArg], [ActionResult], []),
    vote: I.Func([I.Record({ chain: I.Text, task_id: I.Vec(I.Nat8), voter: I.Vec(I.Nat8), choice: Choice, signature: I.Vec(I.Nat8) })], [ActionResult], []),
    get_task: I.Func([I.Text, I.Vec(I.Nat8)], [I.Opt(I.Record({ data: I.Vec(I.Nat8), certificate: I.Opt(I.Vec(I.Nat8)), witness: I.Vec(I.Nat8) }))], ["query"]),
    list_tasks: I.Func([I.Text, I.Vec(I.Nat8)], [I.Vec(I.Vec(I.Nat8))], ["query"]),
    get_resolver: I.Func([I.Text], [I.Opt(I.Vec(I.Nat8))], ["query"]),
    get_verdict: I.Func([I.Text, I.Vec(I.Nat8)], [I.Opt(I.Record({ outcome: Outcome, signature: I.Opt(I.Vec(I.Nat8)) }))], ["query"]),
  });
};

export const tasksCanister = () => makeActor<TasksCanister>(TASKS_PRINCIPAL, tasksIdl);

// ---- Conditional-Funding -------------------------------------------------

export interface FundingCanister {
  create_collection: (arg: { chain: string; recipient: Uint8Array; recipient_nonce: bigint; goal: bigint; duration: bigint; signature: Uint8Array }) => Promise<{ Ok: Uint8Array } | { Err: string }>;
  ready: (arg: { chain: string; collection_id: Uint8Array; signature: Uint8Array }) => Promise<{ Ok: null } | { Err: string }>;
  recipient_cancel: (arg: { chain: string; collection_id: Uint8Array; signature: Uint8Array }) => Promise<{ Ok: null } | { Err: string }>;
  vote: (arg: { chain: string; collection_id: Uint8Array; voter: Uint8Array; choice: { done: null } | { not_done: null }; signature: Uint8Array }) => Promise<{ Ok: null } | { Err: string }>;
  request_signature: (arg: { chain: string; collection_id: Uint8Array; donor: Uint8Array; gross: bigint; deadline: bigint; nonce: bigint }) => Promise<{ Ok: { escrow: Uint8Array; outcome: { settle: null } | { refund: null }; signature: Uint8Array } } | { Err: string }>;
  get_collection: (chain: string, id: Uint8Array) => Promise<[] | [{ data: Uint8Array; certificate: [] | [Uint8Array]; witness: Uint8Array }]>;
  get_resolver: (chain: string, id: Uint8Array) => Promise<[] | [Uint8Array]>;
}

const fundingIdl: IDL.InterfaceFactory = ({ IDL: I }) => {
  const FOutcome = I.Variant({ settle: I.Null, refund: I.Null });
  const ActionResult = I.Variant({ Ok: I.Null, Err: I.Text });
  return I.Service({
    create_collection: I.Func([I.Record({ chain: I.Text, recipient: I.Vec(I.Nat8), recipient_nonce: I.Nat64, goal: I.Nat64, duration: I.Nat64, signature: I.Vec(I.Nat8) })], [I.Variant({ Ok: I.Vec(I.Nat8), Err: I.Text })], []),
    ready: I.Func([I.Record({ chain: I.Text, collection_id: I.Vec(I.Nat8), signature: I.Vec(I.Nat8) })], [ActionResult], []),
    recipient_cancel: I.Func([I.Record({ chain: I.Text, collection_id: I.Vec(I.Nat8), signature: I.Vec(I.Nat8) })], [ActionResult], []),
    vote: I.Func([I.Record({ chain: I.Text, collection_id: I.Vec(I.Nat8), voter: I.Vec(I.Nat8), choice: Choice, signature: I.Vec(I.Nat8) })], [ActionResult], []),
    request_signature: I.Func([I.Record({ chain: I.Text, collection_id: I.Vec(I.Nat8), donor: I.Vec(I.Nat8), gross: I.Nat64, deadline: I.Nat64, nonce: I.Nat64 })], [I.Variant({ Ok: I.Record({ escrow: I.Vec(I.Nat8), outcome: FOutcome, signature: I.Vec(I.Nat8) }), Err: I.Text })], []),
    get_collection: I.Func([I.Text, I.Vec(I.Nat8)], [I.Opt(I.Record({ data: I.Vec(I.Nat8), certificate: I.Opt(I.Vec(I.Nat8)), witness: I.Vec(I.Nat8) }))], ["query"]),
    get_resolver: I.Func([I.Text, I.Vec(I.Nat8)], [I.Opt(I.Vec(I.Nat8))], ["query"]),
  });
};

export const fundingCanister = () => makeActor<FundingCanister>(FUNDING_PRINCIPAL, fundingIdl);

// ---- Auction --------------------------------------------------------------

export interface AuctionCanister {
  create_auction: (arg: { chain: string; recipient: Uint8Array; recipient_nonce: bigint; duration: bigint; perform_window: bigint; min_entry: bigint; signature: Uint8Array }) => Promise<{ Ok: Uint8Array } | { Err: string }>;
  get_resolver: (arg: { auction_id: Uint8Array; text_hash: Uint8Array }) => Promise<{ Ok: Uint8Array } | { Err: string }>;
  register_entry: (arg: { chain: string; auction_id: Uint8Array; text_hash: Uint8Array; donor: Uint8Array; gross: bigint; deadline: bigint; nonce: bigint }) => Promise<{ Ok: null } | { Err: string }>;
  accept_lot: (arg: LotAction) => Promise<{ Ok: null } | { Err: string }>;
  return_lot: (arg: LotAction) => Promise<{ Ok: null } | { Err: string }>;
  ready: (arg: AuctionAction) => Promise<{ Ok: null } | { Err: string }>;
  cancel_auction: (arg: AuctionAction) => Promise<{ Ok: null } | { Err: string }>;
  vote: (arg: { chain: string; auction_id: Uint8Array; voter: Uint8Array; choice: { done: null } | { not_done: null }; signature: Uint8Array }) => Promise<{ Ok: null } | { Err: string }>;
  request_signature: (arg: { chain: string; auction_id: Uint8Array; text_hash: Uint8Array; donor: Uint8Array; gross: bigint; deadline: bigint; nonce: bigint }) => Promise<{ Ok: { escrow: Uint8Array; outcome: { settle: null } | { cancel: null }; signature: Uint8Array } } | { Err: string }>;
  get_auction: (chain: string, id: Uint8Array) => Promise<[] | [{ data: Uint8Array; certificate: [] | [Uint8Array]; witness: Uint8Array }]>;
  list_lots: (chain: string, auctionId: Uint8Array) => Promise<unknown[]>;
  list_entries: (chain: string, auctionId: Uint8Array, lotId: Uint8Array) => Promise<unknown[]>;
}
interface LotAction { chain: string; auction_id: Uint8Array; lot_id: Uint8Array; signature: Uint8Array }
interface AuctionAction { chain: string; auction_id: Uint8Array; signature: Uint8Array }

const auctionIdl: IDL.InterfaceFactory = ({ IDL: I }) => {
  const AOutcome = I.Variant({ settle: I.Null, cancel: I.Null });
  const ActionResult = I.Variant({ Ok: I.Null, Err: I.Text });
  const ActorV = I.Variant({ recipient: I.Null, operator: I.Null });
  const ReturnStamp = I.Record({ at: I.Nat64, by: ActorV });
  const Lot = I.Record({ lot_id: I.Vec(I.Nat8), text_hash: I.Vec(I.Nat8), resolver: I.Vec(I.Nat8), accepted_at: I.Opt(I.Nat64), returned: I.Opt(ReturnStamp), sum: I.Nat, entries: I.Nat64 });
  const Entry = I.Record({ escrow: I.Vec(I.Nat8), lot_id: I.Vec(I.Nat8), donor: I.Vec(I.Nat8), gross: I.Nat64, deadline: I.Nat64, nonce: I.Nat64, seq: I.Nat64, returned: I.Opt(ReturnStamp) });
  const LotActionArg = I.Record({ chain: I.Text, auction_id: I.Vec(I.Nat8), lot_id: I.Vec(I.Nat8), signature: I.Vec(I.Nat8) });
  const AuctionActionArg = I.Record({ chain: I.Text, auction_id: I.Vec(I.Nat8), signature: I.Vec(I.Nat8) });
  return I.Service({
    create_auction: I.Func([I.Record({ chain: I.Text, recipient: I.Vec(I.Nat8), recipient_nonce: I.Nat64, duration: I.Nat64, perform_window: I.Nat64, min_entry: I.Nat64, signature: I.Vec(I.Nat8) })], [I.Variant({ Ok: I.Vec(I.Nat8), Err: I.Text })], []),
    get_resolver: I.Func([I.Record({ auction_id: I.Vec(I.Nat8), text_hash: I.Vec(I.Nat8) })], [I.Variant({ Ok: I.Vec(I.Nat8), Err: I.Text })], []),
    register_entry: I.Func([I.Record({ chain: I.Text, auction_id: I.Vec(I.Nat8), text_hash: I.Vec(I.Nat8), donor: I.Vec(I.Nat8), gross: I.Nat64, deadline: I.Nat64, nonce: I.Nat64 })], [ActionResult], []),
    accept_lot: I.Func([LotActionArg], [ActionResult], []),
    return_lot: I.Func([LotActionArg], [ActionResult], []),
    ready: I.Func([AuctionActionArg], [ActionResult], []),
    cancel_auction: I.Func([AuctionActionArg], [ActionResult], []),
    vote: I.Func([I.Record({ chain: I.Text, auction_id: I.Vec(I.Nat8), voter: I.Vec(I.Nat8), choice: Choice, signature: I.Vec(I.Nat8) })], [ActionResult], []),
    request_signature: I.Func([I.Record({ chain: I.Text, auction_id: I.Vec(I.Nat8), text_hash: I.Vec(I.Nat8), donor: I.Vec(I.Nat8), gross: I.Nat64, deadline: I.Nat64, nonce: I.Nat64 })], [I.Variant({ Ok: I.Record({ escrow: I.Vec(I.Nat8), outcome: AOutcome, signature: I.Vec(I.Nat8) }), Err: I.Text })], []),
    get_auction: I.Func([I.Text, I.Vec(I.Nat8)], [I.Opt(I.Record({ data: I.Vec(I.Nat8), certificate: I.Opt(I.Vec(I.Nat8)), witness: I.Vec(I.Nat8) }))], ["query"]),
    list_lots: I.Func([I.Text, I.Vec(I.Nat8)], [I.Vec(Lot)], ["query"]),
    list_entries: I.Func([I.Text, I.Vec(I.Nat8), I.Vec(I.Nat8)], [I.Vec(Entry)], ["query"]),
  });
};

export const auctionCanister = () => makeActor<AuctionCanister>(AUCTION_PRINCIPAL, auctionIdl);

// ---- Subscription ----------------------------------------------------------

export interface SubscriptionCanister {
  get_resolver: (chain: string, subscriptionId: Uint8Array) => Promise<{ Ok: Uint8Array } | { Err: string }>;
  request_release: (arg: SubBirth & { index: number }) => Promise<{ Ok: { escrow: Uint8Array; index: number; signature: Uint8Array } } | { Err: string }>;
  request_cancel: (arg: SubBirth & { signature: Uint8Array }) => Promise<{ Ok: { escrow: Uint8Array; signature: Uint8Array } } | { Err: string }>;
}
interface SubBirth {
  chain: string; subscription_id: Uint8Array; donor: Uint8Array; recipients: Uint8Array[]; shares: number[];
  chunk: bigint; n_chunks: number; t0: bigint; period: bigint; nonce: bigint;
}

const subscriptionIdl: IDL.InterfaceFactory = ({ IDL: I }) => {
  const birth = {
    chain: I.Text, subscription_id: I.Vec(I.Nat8), donor: I.Vec(I.Nat8), recipients: I.Vec(I.Vec(I.Nat8)), shares: I.Vec(I.Nat16),
    chunk: I.Nat64, n_chunks: I.Nat16, t0: I.Int64, period: I.Int64, nonce: I.Nat64,
  };
  return I.Service({
    get_resolver: I.Func([I.Text, I.Vec(I.Nat8)], [I.Variant({ Ok: I.Vec(I.Nat8), Err: I.Text })], []),
    request_release: I.Func([I.Record({ ...birth, index: I.Nat16 })], [I.Variant({ Ok: I.Record({ escrow: I.Vec(I.Nat8), index: I.Nat16, signature: I.Vec(I.Nat8) }), Err: I.Text })], []),
    request_cancel: I.Func([I.Record({ ...birth, signature: I.Vec(I.Nat8) })], [I.Variant({ Ok: I.Record({ escrow: I.Vec(I.Nat8), signature: I.Vec(I.Nat8) }), Err: I.Text })], []),
  });
};

export const subscriptionCanister = () => makeActor<SubscriptionCanister>(SUBSCRIPTION_PRINCIPAL, subscriptionIdl);

// Which games can go live right now — the UIs consult this to decide
// chain vs mock per game, mirroring isSplitterConfigured() for donations.
export const gamePrincipals = {
  task: () => TASKS_PRINCIPAL !== "",
  fundraiser: () => FUNDING_PRINCIPAL !== "",
  auction: () => AUCTION_PRINCIPAL !== "",
  subscription: () => SUBSCRIPTION_PRINCIPAL !== "",
};
