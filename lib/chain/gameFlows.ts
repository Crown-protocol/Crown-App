"use client";

import { PublicKey } from "@solana/web3.js";
import { Principal } from "@dfinity/principal";
import {
  CHAIN_ID,
  FEE_BPS,
  FEE_WALLET,
  TASKS_PRINCIPAL,
  FUNDING_PRINCIPAL,
  AUCTION_PRINCIPAL,
  isValidAddress,
} from "./config";
import { toMinorUnits } from "./solana";
import { buildCreateEscrowTx } from "./escrow";
import {
  tasksCanister,
  fundingCanister,
  auctionCanister,
  taskMessage,
  fundingMessage,
  auctionMessage,
  gamePrincipals,
} from "./games";

// ──────────────────────────────────────────────────────────────────
// The full game flows over the Cheer backend — escrow birth on Solana
// (Cheer-Factory two-outcome) + registration/actions on the ICP resolver
// canisters. Everything here composes primitives that are pinned by the
// backend repos' own test vectors (cheer-salt, PDA, message formats, id
// derivations), so when the canisters get public principals (env), these
// flows go live UNCHANGED. Until then gamePrincipals.<game>() is false and
// no UI path reaches this file.
//
// Error model: every flow returns {ok:true,...} | {ok:false,error} — the
// canisters aren't deployed yet, RPC can flake, wallets get declined; the
// UIs show the error and keep their mock/synced state untouched.
// ──────────────────────────────────────────────────────────────────

export type FlowResult<T> = ({ ok: true } & T) | { ok: false; error: string };

// The wallet surface the flows need — matches useSolanaWallet().
export interface FlowWallet {
  address: string;
  signMessage: (message: Uint8Array) => Promise<Uint8Array | null>;
  sendTransaction: (tx: import("@solana/web3.js").Transaction) => Promise<string>;
}

const enc = new TextEncoder();

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data as BufferSource));
}

export const hex = (b: Uint8Array | Buffer): string =>
  Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");

export function fromHex(s: string): Uint8Array {
  const clean = s.trim().toLowerCase();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * What a viewer is told when the game's on-chain half isn't reachable.
 *
 * Every one of these cases is the same thing from the person's side: this game can't take money
 * right now. Which piece of our plumbing is missing — the canister principal, the IC gateway, a
 * resolver key — is our problem, not theirs, and naming it leaks the build's internals into a
 * donation screen. One sentence, and it stays true whichever piece is the one that's absent.
 */
const NOT_LIVE = "This game isn't taking money right now — try again later.";

function err(e: unknown): { ok: false; error: string } {
  const raw = e instanceof Error ? e.message : String(e);
  const first = raw.split("\n")[0].trim();
  // A dead/unreachable IC gateway throws a fetch error with a full stack — the donor gets one
  // honest human line, never a trace.
  const friendly = /failed to fetch|fetch failed|networkerror|load failed/i.test(first)
    ? "The game backend is unreachable right now — try again in a minute."
    : first.slice(0, 160);
  return { ok: false, error: friendly };
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const u64leBytes = (v: bigint): Uint8Array => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, v, true);
  return b;
};

// ---- deterministic ids (pinned by the canisters' auth.rs vectors) --------

// collection_id = sha256("cheer:conditional-funding" ‖ len(canister) u8 ‖ canister ‖ recipient ‖ nonce_le)
export async function deriveCollectionId(canisterPrincipal: string, recipient: PublicKey, nonce: bigint): Promise<Uint8Array> {
  const cid = Principal.fromText(canisterPrincipal).toUint8Array();
  return sha256(concat(enc.encode("cheer:conditional-funding"), new Uint8Array([cid.length]), cid, recipient.toBytes(), u64leBytes(nonce)));
}

// auction_id = sha256("cheer:auction" ‖ len(canister) u8 ‖ canister ‖ recipient ‖ nonce_le)
export async function deriveAuctionId(canisterPrincipal: string, recipient: PublicKey, nonce: bigint): Promise<Uint8Array> {
  const cid = Principal.fromText(canisterPrincipal).toUint8Array();
  return sha256(concat(enc.encode("cheer:auction"), new Uint8Array([cid.length]), cid, recipient.toBytes(), u64leBytes(nonce)));
}

// lot_id = sha256(auction_id ‖ text_hash)
export async function deriveLotId(auctionId: Uint8Array, textHash: Uint8Array): Promise<Uint8Array> {
  return sha256(concat(auctionId, textHash));
}

async function signed(wallet: FlowWallet, message: string): Promise<Uint8Array> {
  const sig = await wallet.signMessage(enc.encode(message));
  if (!sig) throw new Error("Signature declined.");
  return sig;
}

// Attach the human words to an escrow in the Cheer DB (canisters pin hashes only).
async function postText(t: { id: string; game: string; handle: string; escrow: string; body: string; salt?: string }): Promise<void> {
  await fetch("/api/texts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(t),
  }).catch(() => {});
}

// ══════════════════════════════ TASK ══════════════════════════════

// Viewer sets a paid task: resolver from the canister → escrow on Solana → register on the
// canister (donor-signed) → words into the Cheer DB. task_id ≡ the escrow address.
export async function taskStartOnChain(
  wallet: FlowWallet,
  input: { recipient: string; dollars: number; durationHours: number; text: string; handle: string }
): Promise<FlowResult<{ escrow: string; txSig: string }>> {
  try {
    if (!gamePrincipals.task()) return { ok: false, error: NOT_LIVE };
    if (!isValidAddress(input.recipient)) return { ok: false, error: "This page has no valid payout address." };
    const canister = await tasksCanister();
    if (!canister) return { ok: false, error: NOT_LIVE };

    const resolverOpt = await canister.get_resolver(CHAIN_ID);
    const resolverBytes = Array.isArray(resolverOpt) ? resolverOpt[0] : undefined;
    if (!resolverBytes) return { ok: false, error: NOT_LIVE };

    const donor = new PublicKey(wallet.address);
    const streamer = new PublicKey(input.recipient);
    const gross = toMinorUnits(input.dollars);
    const durationSec = BigInt(Math.round(input.durationHours * 3600));
    const deadline = BigInt(Math.floor(Date.now() / 1000)) + durationSec;
    const nonce = BigInt(Date.now());
    const resolver = new PublicKey(new Uint8Array(resolverBytes));

    const { tx, escrow, salt } = await buildCreateEscrowTx({
      donor, streamer, gross, deadline, resolver, feeBps: FEE_BPS, feeWallet: FEE_WALLET, nonce,
    });
    const txSig = await wallet.sendTransaction(tx);

    const textHash = await sha256(enc.encode(input.text));
    const msg = taskMessage.register(TASKS_PRINCIPAL, escrow.toBase58(), hex(textHash), Number(durationSec));
    const signature = await signed(wallet, msg);

    const res = await canister.register_task({
      chain: CHAIN_ID,
      donor: donor.toBytes(),
      recipient: streamer.toBytes(),
      gross,
      deadline,
      resolver: resolver.toBytes(),
      nonce,
      duration: durationSec,
      text_hash: textHash,
      signature,
    });
    if ("Err" in res) return { ok: false, error: res.Err };

    await postText({ id: escrow.toBase58(), game: "task", handle: input.handle, escrow: escrow.toBase58(), body: input.text, salt: hex(salt) });
    return { ok: true, escrow: escrow.toBase58(), txSig };
  } catch (e) {
    return err(e);
  }
}

// Streamer's accept / decline / "done, judge me" — and anyone's vote.
export async function taskAction(wallet: FlowWallet, escrowB58: string, action: "accept" | "decline" | "ready"): Promise<FlowResult<object>> {
  try {
    const canister = await tasksCanister();
    if (!canister) return { ok: false, error: NOT_LIVE };
    const taskId = new PublicKey(escrowB58).toBytes();
    const signature = await signed(wallet, taskMessage.action(action, TASKS_PRINCIPAL, escrowB58));
    const res = await canister[action]({ chain: CHAIN_ID, task_id: taskId, signature });
    return "Err" in res ? { ok: false, error: res.Err } : { ok: true };
  } catch (e) {
    return err(e);
  }
}

export async function taskVote(wallet: FlowWallet, escrowB58: string, choice: "done" | "not_done"): Promise<FlowResult<object>> {
  try {
    const canister = await tasksCanister();
    if (!canister) return { ok: false, error: NOT_LIVE };
    const signature = await signed(wallet, taskMessage.vote(TASKS_PRINCIPAL, escrowB58, choice));
    const res = await canister.vote({
      chain: CHAIN_ID,
      task_id: new PublicKey(escrowB58).toBytes(),
      voter: new PublicKey(wallet.address).toBytes(),
      choice: choice === "done" ? { done: null } : { not_done: null },
      signature,
    });
    return "Err" in res ? { ok: false, error: res.Err } : { ok: true };
  } catch (e) {
    return err(e);
  }
}

// ═══════════════════════════ FUNDRAISER ═══════════════════════════

// Streamer opens a collection: the id is derived first (it's part of the signed message),
// then the canister creates it. Returns the id hex the page stores in the synced status.
export async function fundingCreateCollection(
  wallet: FlowWallet,
  input: { goalDollars: number; durationDays: number }
): Promise<FlowResult<{ collectionHex: string; nonce: string }>> {
  try {
    if (!gamePrincipals.fundraiser()) return { ok: false, error: NOT_LIVE };
    const canister = await fundingCanister();
    if (!canister) return { ok: false, error: NOT_LIVE };

    const recipient = new PublicKey(wallet.address);
    const nonce = BigInt(Date.now());
    const goal = toMinorUnits(input.goalDollars);
    const duration = BigInt(Math.round(input.durationDays * 86400));
    const id = await deriveCollectionId(FUNDING_PRINCIPAL, recipient, nonce);

    const signature = await signed(wallet, fundingMessage.create(FUNDING_PRINCIPAL, hex(id), Number(goal), Number(duration)));
    const res = await canister.create_collection({
      chain: CHAIN_ID, recipient: recipient.toBytes(), recipient_nonce: nonce, goal, duration, signature,
    });
    if ("Err" in res) return { ok: false, error: res.Err };
    return { ok: true, collectionHex: hex(new Uint8Array(res.Ok)), nonce: String(nonce) };
  } catch (e) {
    return err(e);
  }
}

// Viewer chips in: resolver keyed to the collection → escrow birth. No canister write —
// the per-collection resolver key is what ties every such escrow to one verdict.
export async function fundingChipIn(
  wallet: FlowWallet,
  input: { collectionHex: string; recipient: string; dollars: number; deadlineDays: number }
): Promise<FlowResult<{ escrow: string; txSig: string }>> {
  try {
    if (!gamePrincipals.fundraiser()) return { ok: false, error: NOT_LIVE };
    if (!isValidAddress(input.recipient)) return { ok: false, error: "This page has no valid payout address." };
    const canister = await fundingCanister();
    if (!canister) return { ok: false, error: NOT_LIVE };

    const resolverOpt = await canister.get_resolver(CHAIN_ID, fromHex(input.collectionHex));
    const resolverBytes = Array.isArray(resolverOpt) ? resolverOpt[0] : undefined;
    if (!resolverBytes) return { ok: false, error: NOT_LIVE };

    const donor = new PublicKey(wallet.address);
    const { tx, escrow } = await buildCreateEscrowTx({
      donor,
      streamer: new PublicKey(input.recipient),
      gross: toMinorUnits(input.dollars),
      deadline: BigInt(Math.floor(Date.now() / 1000) + Math.round(input.deadlineDays * 86400)),
      resolver: new PublicKey(new Uint8Array(resolverBytes)),
      feeBps: FEE_BPS,
      feeWallet: FEE_WALLET,
      nonce: BigInt(Date.now()),
    });
    const txSig = await wallet.sendTransaction(tx);
    return { ok: true, escrow: escrow.toBase58(), txSig };
  } catch (e) {
    return err(e);
  }
}

// Streamer: "delivered — judge me" / cancel-and-refund. Voters: the verdict.
export async function fundingAction(wallet: FlowWallet, collectionHex: string, action: "ready" | "recipient_cancel"): Promise<FlowResult<object>> {
  try {
    const canister = await fundingCanister();
    if (!canister) return { ok: false, error: NOT_LIVE };
    const word = action === "ready" ? "ready" : "recipient_cancel";
    const signature = await signed(wallet, fundingMessage.action(word, FUNDING_PRINCIPAL, collectionHex));
    const res = await canister[action]({ chain: CHAIN_ID, collection_id: fromHex(collectionHex), signature });
    return "Err" in res ? { ok: false, error: res.Err } : { ok: true };
  } catch (e) {
    return err(e);
  }
}

export async function fundingVote(wallet: FlowWallet, collectionHex: string, choice: "done" | "not_done"): Promise<FlowResult<object>> {
  try {
    const canister = await fundingCanister();
    if (!canister) return { ok: false, error: NOT_LIVE };
    const signature = await signed(wallet, fundingMessage.vote(FUNDING_PRINCIPAL, collectionHex, choice));
    const res = await canister.vote({
      chain: CHAIN_ID,
      collection_id: fromHex(collectionHex),
      voter: new PublicKey(wallet.address).toBytes(),
      choice: choice === "done" ? { done: null } : { not_done: null },
      signature,
    });
    return "Err" in res ? { ok: false, error: res.Err } : { ok: true };
  } catch (e) {
    return err(e);
  }
}

// ═════════════════════════════ AUCTION ═════════════════════════════

export async function auctionCreate(
  wallet: FlowWallet,
  input: { durationHours: number; performHours: number; minEntryDollars: number }
): Promise<FlowResult<{ auctionHex: string; nonce: string }>> {
  try {
    if (!gamePrincipals.auction()) return { ok: false, error: NOT_LIVE };
    const canister = await auctionCanister();
    if (!canister) return { ok: false, error: NOT_LIVE };

    const recipient = new PublicKey(wallet.address);
    const nonce = BigInt(Date.now());
    const duration = BigInt(Math.round(input.durationHours * 3600));
    const performWindow = BigInt(Math.round(input.performHours * 3600));
    const minEntry = toMinorUnits(input.minEntryDollars);

    const signature = await signed(
      wallet,
      auctionMessage.create(AUCTION_PRINCIPAL, Number(nonce), Number(duration), Number(performWindow), Number(minEntry))
    );
    const res = await canister.create_auction({
      chain: CHAIN_ID, recipient: recipient.toBytes(), recipient_nonce: nonce,
      duration, perform_window: performWindow, min_entry: minEntry, signature,
    });
    if ("Err" in res) return { ok: false, error: res.Err };
    return { ok: true, auctionHex: hex(new Uint8Array(res.Ok)), nonce: String(nonce) };
  } catch (e) {
    return err(e);
  }
}

// Viewer places a lot (or tops one up — same escrow path, same text): resolver for
// (auction, text) → escrow birth → register_entry (no signature: the canister reads the chain).
export async function auctionPlaceEntry(
  wallet: FlowWallet,
  input: { auctionHex: string; recipient: string; dollars: number; deadlineHours: number; text: string; handle: string }
): Promise<FlowResult<{ escrow: string; txSig: string; lotHex: string }>> {
  try {
    if (!gamePrincipals.auction()) return { ok: false, error: NOT_LIVE };
    if (!isValidAddress(input.recipient)) return { ok: false, error: "This page has no valid payout address." };
    const canister = await auctionCanister();
    if (!canister) return { ok: false, error: NOT_LIVE };

    const auctionId = fromHex(input.auctionHex);
    const textHash = await sha256(enc.encode(input.text));
    const resolverRes = await canister.get_resolver({ auction_id: auctionId, text_hash: textHash });
    if ("Err" in resolverRes) return { ok: false, error: resolverRes.Err };

    const donor = new PublicKey(wallet.address);
    const gross = toMinorUnits(input.dollars);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + Math.round(input.deadlineHours * 3600));
    const nonce = BigInt(Date.now());
    const { tx, escrow, salt } = await buildCreateEscrowTx({
      donor,
      streamer: new PublicKey(input.recipient),
      gross,
      deadline,
      resolver: new PublicKey(new Uint8Array(resolverRes.Ok)),
      feeBps: FEE_BPS,
      feeWallet: FEE_WALLET,
      nonce,
    });
    const txSig = await wallet.sendTransaction(tx);

    const reg = await canister.register_entry({
      chain: CHAIN_ID, auction_id: auctionId, text_hash: textHash,
      donor: donor.toBytes(), gross, deadline, nonce,
    });
    if ("Err" in reg) return { ok: false, error: reg.Err };

    const lotId = await deriveLotId(auctionId, textHash);
    await postText({ id: hex(lotId), game: "auction", handle: input.handle, escrow: escrow.toBase58(), body: input.text, salt: hex(salt) });
    return { ok: true, escrow: escrow.toBase58(), txSig, lotHex: hex(lotId) };
  } catch (e) {
    return err(e);
  }
}

export async function auctionLotAction(wallet: FlowWallet, auctionHex: string, lotHex: string, action: "accept" | "return-lot"): Promise<FlowResult<object>> {
  try {
    const canister = await auctionCanister();
    if (!canister) return { ok: false, error: NOT_LIVE };
    const signature = await signed(wallet, auctionMessage.lot(action, AUCTION_PRINCIPAL, auctionHex, lotHex));
    const arg = { chain: CHAIN_ID, auction_id: fromHex(auctionHex), lot_id: fromHex(lotHex), signature };
    const res = action === "accept" ? await canister.accept_lot(arg) : await canister.return_lot(arg);
    return "Err" in res ? { ok: false, error: res.Err } : { ok: true };
  } catch (e) {
    return err(e);
  }
}

export async function auctionAction(wallet: FlowWallet, auctionHex: string, action: "ready" | "cancel"): Promise<FlowResult<object>> {
  try {
    const canister = await auctionCanister();
    if (!canister) return { ok: false, error: NOT_LIVE };
    const signature = await signed(wallet, auctionMessage.auction(action, AUCTION_PRINCIPAL, auctionHex));
    const arg = { chain: CHAIN_ID, auction_id: fromHex(auctionHex), signature };
    const res = action === "ready" ? await canister.ready(arg) : await canister.cancel_auction(arg);
    return "Err" in res ? { ok: false, error: res.Err } : { ok: true };
  } catch (e) {
    return err(e);
  }
}

export async function auctionVote(wallet: FlowWallet, auctionHex: string, choice: "done" | "not_done"): Promise<FlowResult<object>> {
  try {
    const canister = await auctionCanister();
    if (!canister) return { ok: false, error: NOT_LIVE };
    const signature = await signed(wallet, auctionMessage.vote(AUCTION_PRINCIPAL, auctionHex, choice));
    const res = await canister.vote({
      chain: CHAIN_ID,
      auction_id: fromHex(auctionHex),
      voter: new PublicKey(wallet.address).toBytes(),
      choice: choice === "done" ? { done: null } : { not_done: null },
      signature,
    });
    return "Err" in res ? { ok: false, error: res.Err } : { ok: true };
  } catch (e) {
    return err(e);
  }
}
