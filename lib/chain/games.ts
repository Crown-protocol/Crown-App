import { Actor, HttpAgent, type ActorSubclass } from "@dfinity/agent";
import { IDL } from "@dfinity/candid";
import { Principal } from "@dfinity/principal";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import {
  APPROVAL_THRESHOLD,
  CHAIN_ID,
  FEE_BPS,
  FEE_WALLET,
  FUNDING_PRINCIPAL,
  IC_HOST,
  QUORUM_WEIGHT,
  TASKS_PRINCIPAL,
  VOTING_PERIOD,
  isFundingConfigured,
  isTasksConfigured,
} from "./config";
import { i64le, sha256, u16le, u64le } from "./solana";
import { message } from "./wire";

// ──────────────────────────────────────────────────────────────────
// The two MVP game canisters — conditional-tasks and conditional-funding —
// exactly as their frozen .did files describe them.
//
// Every update takes ONE `text` argument (the signed request of `wire.ts`) and
// answers with a flat typed variant. There are no record arguments and no
// Ok/Err results: the games' whole boundary is that one string, because the
// authorization is the wallet's signature over it and never the IC caller.
//
// Two of the methods here are NOT callable from a browser and are listed only
// so the server's relay client shares one description of the canisters:
// `push_root` and `request_signature` are paid pulls, fronted by crown-relay
// (an ingress caller cannot attach cycles). See lib/server/submitter.ts.
// ──────────────────────────────────────────────────────────────────

const enc = new TextEncoder();

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

// ---- scope ids ----------------------------------------------------------
//
// A scope id is a free identifier, never an address: the escrow address depends
// on the resolver, the resolver derives from the scope id, so an id built from
// the address would close a cycle. Both preimages below are byte-exact against
// the canisters' `protocol.rs` (their unit tests pin the same bytes), including
// the single-byte length prefix on the principal — without it, a canister id and
// the field after it could be re-split into a different pair with the same hash.

/**
 * `task_id` = sha256("crown:conditional-tasks" ‖ u8(len) ‖ canister ‖ donor ‖
 * recipient ‖ gross u64LE ‖ deadline i64LE ‖ fee_bps u16LE ‖ fee_wallet ‖
 * nonce u64LE ‖ duration u64LE ‖ voting_period u64LE)
 *
 * It commits the escrow's whole salt except the resolver, plus the timings — so
 * one task is one escrow, and a second escrow with a different amount or
 * deadline is a different scope with a different verdict.
 */
export async function deriveTaskId(args: {
  canister: string;
  donor: PublicKey;
  recipient: PublicKey;
  gross: bigint;
  deadline: bigint;
  nonce: bigint;
  duration: bigint;
  feeBps?: number;
  feeWallet?: PublicKey;
  votingPeriod?: number;
}): Promise<Buffer> {
  const cid = Principal.fromText(args.canister).toUint8Array();
  return sha256(
    Buffer.concat([
      Buffer.from("crown:conditional-tasks", "utf8"),
      Buffer.from([cid.length]),
      Buffer.from(cid),
      args.donor.toBuffer(),
      args.recipient.toBuffer(),
      u64le(args.gross),
      i64le(args.deadline),
      u16le(args.feeBps ?? FEE_BPS),
      (args.feeWallet ?? FEE_WALLET).toBuffer(),
      u64le(args.nonce),
      u64le(args.duration),
      u64le(BigInt(args.votingPeriod ?? VOTING_PERIOD)),
    ])
  );
}

/**
 * `collection_id` = sha256("crown:conditional-funding" ‖ u8(len) ‖ canister ‖
 * recipient ‖ recipient_nonce u64LE ‖ duration u64LE ‖ voting_period u64LE ‖
 * approval_threshold u16LE ‖ quorum_weight u128LE)
 *
 * Unlike a task it does not commit `gross`/`deadline` — a collection has many
 * escrows — but it does commit the whole rules snapshot, so a collection cannot
 * be re-created under softer verdict parameters.
 */
export async function deriveCollectionId(args: {
  canister: string;
  recipient: PublicKey;
  recipientNonce: bigint;
  duration: bigint;
  votingPeriod?: number;
  approvalThreshold?: number;
  quorumWeight?: bigint;
}): Promise<Buffer> {
  const cid = Principal.fromText(args.canister).toUint8Array();
  const quorum = Buffer.alloc(16);
  let q = args.quorumWeight ?? QUORUM_WEIGHT;
  for (let i = 0; i < 16; i++) {
    quorum[i] = Number(q & 0xffn);
    q >>= 8n;
  }
  return sha256(
    Buffer.concat([
      Buffer.from("crown:conditional-funding", "utf8"),
      Buffer.from([cid.length]),
      Buffer.from(cid),
      args.recipient.toBuffer(),
      u64le(args.recipientNonce),
      u64le(args.duration),
      u64le(BigInt(args.votingPeriod ?? VOTING_PERIOD)),
      u16le(args.approvalThreshold ?? APPROVAL_THRESHOLD),
      quorum,
    ])
  );
}

// ---- signed messages ----------------------------------------------------
//
// The domain line is the first line and it is verified: a signature over any
// other text authorizes nothing. Field order is the canisters' frozen order —
// they rebuild this exact string to check the signature.
//
// Note the two id encodings differ, and that is the canisters' choice, not a
// slip: a task rides as base58, a collection as hex.

export const TASKS_DOMAIN = "crown:conditional-tasks:v1";
export const FUNDING_DOMAIN = "crown:conditional-funding:v1";

const taskHead = (action: string, taskB58: string): Array<[string, string]> => [
  ["action", action],
  ["chain", CHAIN_ID],
  ["canister", TASKS_PRINCIPAL],
  ["task", taskB58],
];

export const taskMessage = {
  register: (taskB58: string, textHashHex: string, duration: bigint) =>
    message(TASKS_DOMAIN, [...taskHead("register", taskB58), ["text", textHashHex], ["duration", String(duration)]]),
  action: (action: "accept" | "decline" | "ready", taskB58: string) =>
    message(TASKS_DOMAIN, taskHead(action, taskB58)),
  vote: (taskB58: string, choice: "done" | "not_done") =>
    message(TASKS_DOMAIN, [...taskHead("vote", taskB58), ["choice", choice]]),
};

const fundingHead = (action: string, collectionHex: string): Array<[string, string]> => [
  ["action", action],
  ["chain", CHAIN_ID],
  ["canister", FUNDING_PRINCIPAL],
  ["collection", collectionHex],
];

export const fundingMessage = {
  create: (collectionHex: string, goal: bigint, duration: bigint) =>
    message(FUNDING_DOMAIN, [
      ...fundingHead("create", collectionHex),
      ["goal", String(goal)],
      ["duration", String(duration)],
    ]),
  action: (action: "ready" | "cancel", collectionHex: string) =>
    message(FUNDING_DOMAIN, fundingHead(action, collectionHex)),
  vote: (collectionHex: string, choice: "done" | "not_done") =>
    message(FUNDING_DOMAIN, [...fundingHead("vote", collectionHex), ["choice", choice]]),
};

// ---- candid ------------------------------------------------------------

const SignatureView = IDL.Record({ signature: IDL.Vec(IDL.Nat8), outcome: IDL.Nat8 });
const TaskStateView = IDL.Variant({
  DecidedSettle: IDL.Null,
  DecidedCancel: IDL.Null,
  Voting: IDL.Null,
  Accepted: IDL.Null,
  Created: IDL.Null,
});
const CollectionStateView = IDL.Variant({
  DecidedSettle: IDL.Null,
  DecidedRefund: IDL.Null,
  Voting: IDL.Null,
  Funding: IDL.Null,
});
const CollectionView = IDL.Record({
  duration: IDL.Nat64,
  voting_period: IDL.Nat64,
  recipient: IDL.Text,
  created_at: IDL.Nat64,
  state: CollectionStateView,
});

// The flat refusal set both games share, plus each one's own state/success arms.
// Listing every arm matters: Candid decodes a variant by hash, and an arm this
// client omits arrives as a decode error rather than as the refusal it is.
const REFUSALS = [
  "Underpaid",
  "DurationOutOfRange",
  "RootPushed",
  "VoteCapReached",
  "InvalidTransition",
  "NotFound",
  "NotBootstrapped",
  "KeyBootstrapped",
  "AlreadyExists",
  "BadBirthProof",
  "TimeOverflow",
  "Malformed",
  "FieldMismatch",
  "NotDecided",
  "Materialized",
  "SignInFlight",
  "GrossBelowFloor",
  "SignFailed",
  "DuplicateVoter",
  "WrongTarget",
  "DeadlineTooTight",
  "StepOverflow",
  "WeightBelowThreshold",
  "NotRecipient",
] as const;

function variantOf(extra: Record<string, IDL.Type>): IDL.VariantClass {
  const arms: Record<string, IDL.Type> = {};
  for (const r of REFUSALS) arms[r] = IDL.Null;
  return IDL.Variant({ ...arms, ...extra });
}

export const TaskResult = variantOf({
  Advanced: TaskStateView,
  Signed: SignatureView,
  TaskIdMismatch: IDL.Null,
});
export const CollectionResult = variantOf({
  Advanced: CollectionStateView,
  Signed: SignatureView,
  CollectionIdMismatch: IDL.Null,
  CreatedAtOverflow: IDL.Null,
});

/** One arm of a game's answer: `{ Malformed: null }`, `{ Advanced: {...} }`, … */
export type GameResult = Record<string, unknown>;

export const resultTag = (r: GameResult): string => Object.keys(r)[0] ?? "Malformed";

/**
 * Did the call do what it was asked to? Everything else is a refusal.
 *
 * `Materialized` belongs here: it is how a lazy creation reports success — the
 * scope did not exist, the proof was good, and now it does.
 */
export function isAdvanced(r: GameResult): boolean {
  const tag = resultTag(r);
  return (
    tag === "Advanced" ||
    tag === "Materialized" ||
    tag === "Signed" ||
    tag === "RootPushed" ||
    tag === "KeyBootstrapped"
  );
}

export interface TasksCanister {
  register_task: (text: string) => Promise<GameResult>;
  accept: (text: string) => Promise<GameResult>;
  decline: (text: string) => Promise<GameResult>;
  ready: (text: string) => Promise<GameResult>;
  vote: (text: string) => Promise<GameResult>;
  bootstrap: () => Promise<GameResult>;
  push_root: (cert: Uint8Array) => Promise<GameResult>;
  request_signature: (chain: string, task: string) => Promise<GameResult>;
  get_task: (task: string) => Promise<[] | [GameResult]>;
  get_verdict: (task: string) => Promise<[] | [GameResult]>;
  get_signature: (task: string) => Promise<[] | [{ signature: Uint8Array; outcome: number }]>;
  get_resolver: (task: string) => Promise<[] | [string]>;
  get_sign_price: () => Promise<bigint>;
  get_logic_version: () => Promise<number>;
}

const tasksIdl: IDL.InterfaceFactory = () =>
  IDL.Service({
    register_task: IDL.Func([IDL.Text], [TaskResult], []),
    accept: IDL.Func([IDL.Text], [TaskResult], []),
    decline: IDL.Func([IDL.Text], [TaskResult], []),
    ready: IDL.Func([IDL.Text], [TaskResult], []),
    vote: IDL.Func([IDL.Text], [TaskResult], []),
    bootstrap: IDL.Func([], [TaskResult], []),
    push_root: IDL.Func([IDL.Vec(IDL.Nat8)], [TaskResult], []),
    request_signature: IDL.Func([IDL.Text, IDL.Text], [TaskResult], []),
    get_task: IDL.Func([IDL.Text], [IDL.Opt(TaskStateView)], ["query"]),
    get_verdict: IDL.Func([IDL.Text], [IDL.Opt(TaskStateView)], ["query"]),
    get_signature: IDL.Func([IDL.Text], [IDL.Opt(SignatureView)], ["query"]),
    get_resolver: IDL.Func([IDL.Text], [IDL.Opt(IDL.Text)], ["query"]),
    get_sign_price: IDL.Func([], [IDL.Nat], ["query"]),
    get_logic_version: IDL.Func([], [IDL.Nat32], ["query"]),
  });

export interface FundingCanister {
  create_collection: (text: string) => Promise<GameResult>;
  ready: (text: string) => Promise<GameResult>;
  recipient_cancel: (text: string) => Promise<GameResult>;
  vote: (text: string) => Promise<GameResult>;
  bootstrap: () => Promise<GameResult>;
  push_root: (cert: Uint8Array) => Promise<GameResult>;
  request_signature: (chain: string, collection: string) => Promise<GameResult>;
  get_collection: (collection: string) => Promise<
    [] | [{ duration: bigint; voting_period: bigint; recipient: string; created_at: bigint; state: GameResult }]
  >;
  get_signature: (collection: string) => Promise<[] | [{ signature: Uint8Array; outcome: number }]>;
  get_resolver: (collection: string) => Promise<[] | [string]>;
  get_sign_price: () => Promise<bigint>;
  get_logic_version: () => Promise<number>;
}

const fundingIdl: IDL.InterfaceFactory = () =>
  IDL.Service({
    create_collection: IDL.Func([IDL.Text], [CollectionResult], []),
    ready: IDL.Func([IDL.Text], [CollectionResult], []),
    recipient_cancel: IDL.Func([IDL.Text], [CollectionResult], []),
    vote: IDL.Func([IDL.Text], [CollectionResult], []),
    bootstrap: IDL.Func([], [CollectionResult], []),
    push_root: IDL.Func([IDL.Vec(IDL.Nat8)], [CollectionResult], []),
    request_signature: IDL.Func([IDL.Text, IDL.Text], [CollectionResult], []),
    get_collection: IDL.Func([IDL.Text], [IDL.Opt(CollectionView)], ["query"]),
    get_signature: IDL.Func([IDL.Text], [IDL.Opt(SignatureView)], ["query"]),
    get_resolver: IDL.Func([IDL.Text], [IDL.Opt(IDL.Text)], ["query"]),
    get_sign_price: IDL.Func([], [IDL.Nat], ["query"]),
    get_logic_version: IDL.Func([], [IDL.Nat32], ["query"]),
  });

export const tasksCanister = () => makeActor<TasksCanister>(TASKS_PRINCIPAL, tasksIdl);
export const fundingCanister = () => makeActor<FundingCanister>(FUNDING_PRINCIPAL, fundingIdl);

/**
 * Which games have a reachable on-chain half.
 *
 * `auction` is deliberately never live: its canister exists in the perimeter and
 * passed its own live run, but the first release is the perimeter plus
 * conditional-tasks and conditional-funding (`07-build-plan.md §P8`). Keeping the
 * key and answering `false` is the honest shape — the auction UI keeps working on
 * its synced mock store, and the day it joins the release this becomes a real
 * check rather than a new concept.
 */
export const gamePrincipals = {
  task: isTasksConfigured,
  fundraiser: isFundingConfigured,
  auction: () => false,
};

/** The scope id encodings the two canisters expect, in one place. */
export const taskRef = (taskId: Uint8Array): string => bs58.encode(taskId);
export const collectionRef = (collectionId: Uint8Array): string =>
  Array.from(collectionId).map((b) => b.toString(16).padStart(2, "0")).join("");

/** sha256 of the human words of a task — the canisters store hashes, never text. */
export async function textHash(text: string): Promise<Buffer> {
  return sha256(enc.encode(text));
}
