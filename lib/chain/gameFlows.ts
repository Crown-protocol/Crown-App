"use client";

import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import {
  DEADLINE_MARGIN,
  FEE_BPS,
  FEE_WALLET,
  FUNDING_PRINCIPAL,
  MIN_GROSS_FUNDING,
  MIN_GROSS_TASK,
  TASKS_PRINCIPAL,
  VOTING_PERIOD,
  isValidAddress,
  fundingCreatedAt,
} from "./config";
import { connection, fromHex, hex, toMinorUnits } from "./solana";
import { buildCreateEscrowTx, buildClaimTx, escrowPda, twoOutcomeSalt } from "./escrow";
import { fetchBirthProof, fetchReputationProof } from "./icp";
import {
  collectionRef,
  deriveCollectionId,
  deriveTaskId,
  fundingCanister,
  fundingMessage,
  gamePrincipals,
  isAdvanced,
  resultTag,
  taskMessage,
  taskRef,
  tasksCanister,
  textHash,
} from "./games";
import { request, withinArgCap } from "./wire";

// ──────────────────────────────────────────────────────────────────
// The two MVP games end to end. Every flow here is the same six-step shape,
// and the order is not ours to choose — it is what the perimeter requires:
//
//   1. derive the scope id      (free, local — it commits the escrow's fields)
//   2. get_resolver(scope)      (free query — the key the escrow is born under)
//   3. create_escrow on Solana  (the donor's own signature, the donor's money)
//   4. fold the birth           (paid, via our submitter: /api/ingest)
//   5. push the index root      (paid, per canister: /api/pushroot)
//   6. register with the witness (free ingress, wallet-signed)
//
// Steps 4 and 5 are why a game canister can be blind: it never reads the chain,
// it walks a proof. Skipping either is not a shortcut — it is a registration
// the boundary refuses with `BadBirthProof` and nothing said about why.
//
// Settling later is the mirror image: the scope decides, the resolver's
// signature is pulled once (paid, /api/verdict) and then ANY escrow of that
// scope can be claimed by anyone holding those bytes.
// ──────────────────────────────────────────────────────────────────

export type FlowResult<T> = ({ ok: true } & T) | { ok: false; error: string };

// The wallet surface the flows need — matches useSolanaWallet().
export interface FlowWallet {
  address: string;
  signMessage: (message: Uint8Array) => Promise<Uint8Array | null>;
  sendTransaction: (tx: import("@solana/web3.js").Transaction) => Promise<string>;
}

const enc = new TextEncoder();

export { hex, fromHex };

/**
 * What a viewer is told when the game's on-chain half isn't reachable. Which
 * piece of our plumbing is missing — a principal, the gateway, a resolver key —
 * is our problem, not theirs, and naming it leaks the build's internals into a
 * donation screen.
 */
const NOT_LIVE = "This game isn't taking money right now — try again later.";

function err(e: unknown): { ok: false; error: string } {
  const raw = e instanceof Error ? e.message : String(e);
  const first = raw.split("\n")[0].trim();
  const friendly = /failed to fetch|fetch failed|networkerror|load failed/i.test(first)
    ? "The game backend is unreachable right now — try again in a minute."
    : first.slice(0, 160);
  return { ok: false, error: friendly };
}

/**
 * A refusal from a canister, in words. The tags are the perimeter's vocabulary,
 * not a person's — and the two that a donor actually causes (`GrossBelowFloor`,
 * `DeadlineTooTight`) deserve a sentence rather than a word.
 */
function refusal(tag: string): string {
  switch (tag) {
    case "GrossBelowFloor":
      return "That amount is below this game's minimum.";
    case "DeadlineTooTight":
      return "There isn't enough time left on this task for a verdict — pick a longer window.";
    case "DurationOutOfRange":
      return "That duration is outside what this game allows.";
    case "BadBirthProof":
      return "The book hasn't caught up with your payment yet — try again in a moment.";
    case "NotBootstrapped":
      return NOT_LIVE;
    case "AlreadyExists":
      return "That's already registered.";
    case "NotRecipient":
      return "Only the page's owner can do that.";
    case "DuplicateVoter":
      return "You've already voted on this.";
    case "WeightBelowThreshold":
      return "You need more reputation with this creator to vote here.";
    case "VoteCapReached":
      return "Voting is closed on this one.";
    case "InvalidTransition":
      return "That can't be done at this stage.";
    case "NotDecided":
      return "This hasn't been decided yet.";
    default:
      return `The game refused this: ${tag}.`;
  }
}

async function signed(wallet: FlowWallet, message: string): Promise<Uint8Array> {
  const sig = await wallet.signMessage(enc.encode(message));
  if (!sig) throw new Error("Signature declined.");
  return sig;
}

// Attach the human words to a scope in our DB — the canisters pin hashes only.
async function postText(t: { id: string; game: string; handle: string; escrow: string; body: string; salt?: string }): Promise<void> {
  await fetch("/api/texts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(t),
  }).catch(() => {});
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await r.json()) as T;
}

/**
 * Buy the fold of one signature and wait for it, because the next step cannot
 * start without it. `pending` is the ordinary answer while the cluster reaches
 * finality — the submitter holds the retry ceiling, so polling here is free.
 */
async function foldBirth(signature: string, escrow: string): Promise<void> {
  for (let i = 0; i < 12; i++) {
    const r = await post<{ status: string; detail?: string }>("/api/ingest", { signature, escrow });
    if (r.status === "applied") return;
    if (r.status === "pending" || r.status === "needs_birth") {
      await new Promise((res) => setTimeout(res, 5_000));
      continue;
    }
    throw new Error(r.detail || "The payment couldn't be recorded in the book.");
  }
  throw new Error("The book hasn't caught up with your payment yet — it will, but this page gave up waiting.");
}

const pushRoot = (game: "task" | "fundraiser") => post<{ ok: boolean }>("/api/pushroot", { game });

// ══════════════════════════════ TASK ══════════════════════════════

/**
 * A viewer sets a paid task.
 *
 * The deadline is computed, never asked for: an escrow must outlive its own
 * verdict (`deadline ≥ now + duration + voting_period + DEADLINE_MARGIN`) or
 * registration refuses it — after the money is already in escrow. The slack on
 * top absorbs the minutes between signing here and the canister's own clock
 * reading `now`.
 */
export async function taskStartOnChain(
  wallet: FlowWallet,
  input: { recipient: string; dollars: number; durationHours: number; text: string; handle: string }
): Promise<FlowResult<{ task: string; escrow: string; txSig: string; deadline: number }>> {
  try {
    if (!gamePrincipals.task()) return { ok: false, error: NOT_LIVE };
    if (!isValidAddress(input.recipient)) return { ok: false, error: "This page has no valid payout address." };
    const canister = await tasksCanister();
    if (!canister) return { ok: false, error: NOT_LIVE };

    const donor = new PublicKey(wallet.address);
    const recipient = new PublicKey(input.recipient);
    const gross = toMinorUnits(input.dollars);
    if (gross < BigInt(MIN_GROSS_TASK)) {
      return { ok: false, error: `That amount is below this game's minimum ($${(MIN_GROSS_TASK / 1e6).toFixed(2)}).` };
    }
    const duration = BigInt(Math.round(input.durationHours * 3600));
    const nonce = BigInt(Date.now());
    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    const deadline = nowSec + duration + BigInt(VOTING_PERIOD) + BigInt(DEADLINE_MARGIN) + 3600n;

    // 1. The scope id — free, local, and it commits every field the escrow's
    //    salt does except the resolver (which derives from this id).
    const taskId = await deriveTaskId({
      canister: TASKS_PRINCIPAL,
      donor,
      recipient,
      gross,
      deadline,
      nonce,
      duration,
    });
    const task = taskRef(taskId);

    // 2. The resolver key of this scope.
    const resolverOpt = await canister.get_resolver(task);
    if (!resolverOpt.length) return { ok: false, error: NOT_LIVE };
    const resolver = new PublicKey(resolverOpt[0]);

    // 3. The donor's own transaction — their money, their signature, and the
    //    only place the donor's identity enters the book.
    const birth = { donor, recipient, gross, deadline, resolver, feeBps: FEE_BPS, feeWallet: FEE_WALLET, nonce };
    const { tx, escrow, salt } = await buildCreateEscrowTx(birth);
    const txSig = await wallet.sendTransaction(tx);

    // 4-5. Fold the birth, refresh the game's view of the book.
    await foldBirth(txSig, escrow.toBase58());
    await pushRoot("task");

    // 6. Register against the witness.
    const proof = await fetchBirthProof(escrow.toBase58());
    if (!proof?.birth) return { ok: false, error: "The book hasn't recorded this payment yet — try again shortly." };

    const th = await textHash(input.text);
    const msg = taskMessage.register(task, hex(th), duration);
    const signature = await signed(wallet, msg);
    const text = request({
      signedMessage: msg,
      pubkey: donor.toBytes(),
      signature,
      extras: [
        ["recipient", recipient.toBase58()],
        ["gross", String(gross)],
        ["deadline", String(deadline)],
        ["nonce", String(nonce)],
        ["witness", hex(proof.witness)],
      ],
    });
    if (!withinArgCap(text)) return { ok: false, error: "This registration is too large for the game's boundary." };

    const res = await canister.register_task(text);
    if (!isAdvanced(res)) return { ok: false, error: refusal(resultTag(res)) };

    await postText({
      id: task,
      game: "task",
      handle: input.handle,
      escrow: escrow.toBase58(),
      body: input.text,
      salt: hex(salt),
    });
    return { ok: true, task, escrow: escrow.toBase58(), txSig, deadline: Number(deadline) };
  } catch (e) {
    return err(e);
  }
}

/** The recipient's accept / decline / "done, judge me". `task` is the base58 scope id. */
export async function taskAction(
  wallet: FlowWallet,
  task: string,
  action: "accept" | "decline" | "ready"
): Promise<FlowResult<object>> {
  try {
    const canister = await tasksCanister();
    if (!canister) return { ok: false, error: NOT_LIVE };
    const msg = taskMessage.action(action, task);
    const signature = await signed(wallet, msg);
    const text = request({ signedMessage: msg, pubkey: new PublicKey(wallet.address).toBytes(), signature });
    const res = await canister[action](text);
    return isAdvanced(res) ? { ok: true } : { ok: false, error: refusal(resultTag(res)) };
  } catch (e) {
    return err(e);
  }
}

/**
 * A reputation-weighted vote. The weight is not asserted — it is proven: the
 * voter presents the book's witness for (chain, voter, recipient) and the game
 * walks it against the root it has cached. Which is why `recipient` is needed
 * here and why a vote can fail with "not enough reputation" honestly.
 */
export async function taskVote(
  wallet: FlowWallet,
  task: string,
  choice: "done" | "not_done",
  recipient: string
): Promise<FlowResult<object>> {
  try {
    const canister = await tasksCanister();
    if (!canister) return { ok: false, error: NOT_LIVE };
    if (!isValidAddress(recipient)) return { ok: false, error: "This page has no valid payout address." };

    const proof = await fetchReputationProof(wallet.address, recipient);
    if (!proof) return { ok: false, error: "The book is unreachable right now — try again in a minute." };

    const msg = taskMessage.vote(task, choice);
    const signature = await signed(wallet, msg);
    const send = async () => {
      const text = request({
        signedMessage: msg,
        pubkey: new PublicKey(wallet.address).toBytes(),
        signature,
        extras: [["weight_witness", hex(proof.witness)]],
      });
      return canister.vote(text);
    };

    let res = await send();
    // A witness the game cannot walk means its cached root is older than the
    // donation that gave this voter their weight — one paid push fixes exactly
    // that, and only that, so it is worth one retry.
    if (resultTag(res) === "BadBirthProof") {
      await pushRoot("task");
      res = await send();
    }
    return isAdvanced(res) ? { ok: true } : { ok: false, error: refusal(resultTag(res)) };
  } catch (e) {
    return err(e);
  }
}

// ═══════════════════════════ FUNDRAISER ═══════════════════════════

/**
 * The recipient opens a collection.
 *
 * Nothing reaches the canister here, and that is the design: a collection is
 * created lazily, against the birth proof of its FIRST contribution, which does
 * not exist yet. So the recipient signs the `create` message now and our server
 * holds it until a donor funds the first escrow (`/api/collection`, spent by
 * `/api/collection/materialize`).
 */
export async function fundingCreateCollection(
  wallet: FlowWallet,
  input: { goalDollars: number; durationDays: number }
): Promise<FlowResult<{ collectionHex: string; nonce: string }>> {
  try {
    if (!gamePrincipals.fundraiser()) return { ok: false, error: NOT_LIVE };

    const recipient = new PublicKey(wallet.address);
    const recipientNonce = BigInt(Date.now());
    const goal = toMinorUnits(input.goalDollars);
    const duration = BigInt(Math.round(input.durationDays * 86400));

    const id = await deriveCollectionId({ canister: FUNDING_PRINCIPAL, recipient, recipientNonce, duration });
    const collectionHex = collectionRef(id);

    const msg = fundingMessage.create(collectionHex, goal, duration);
    const signature = await signed(wallet, msg);

    const saved = await post<{ ok?: boolean; error?: string }>("/api/collection", {
      collectionHex,
      recipient: recipient.toBase58(),
      recipientNonce: String(recipientNonce),
      duration: Number(duration),
      goal: String(goal),
      signedMessage: msg,
      pubkey: recipient.toBase58(),
      signature: bs58.encode(signature),
    });
    if (!saved.ok) return { ok: false, error: saved.error || "The collection couldn't be opened." };

    return { ok: true, collectionHex, nonce: String(recipientNonce) };
  } catch (e) {
    return err(e);
  }
}

/**
 * A viewer chips in. Every contribution is its own escrow under the collection's
 * one resolver — which is what lets a single paid signature settle all of them.
 *
 * The deadline anchors on the collection's own window when it is already open
 * (`created_at` is the first contribution's birth slot, so it is the same for
 * everyone) and on now for the contribution that opens it.
 */
export async function fundingChipIn(
  wallet: FlowWallet,
  input: {
    collectionHex: string;
    recipient: string;
    dollars: number;
    /**
     * The collection's funding window, in seconds, as the recipient signed it.
     *
     * Needed only for the FIRST contribution — the one that opens the collection
     * — and needed absolutely: the canister measures the escrow's deadline
     * against `created_at + duration + voting_period + margin`, where `duration`
     * is the signed one. Without it this flow used `0`, produced an escrow that
     * expires long before the collection's own window, and the boundary refused
     * to open the collection at all. Since only the first contribution can open
     * one, every fundraiser was unopenable and the donor's money sat in an
     * escrow attached to nothing.
     */
    durationSeconds?: number;
  }
): Promise<FlowResult<{ escrow: string; txSig: string; deadline: number }>> {
  try {
    if (!gamePrincipals.fundraiser()) return { ok: false, error: NOT_LIVE };
    if (!isValidAddress(input.recipient)) return { ok: false, error: "This page has no valid payout address." };
    const canister = await fundingCanister();
    if (!canister) return { ok: false, error: NOT_LIVE };

    const gross = toMinorUnits(input.dollars);
    if (gross < BigInt(MIN_GROSS_FUNDING)) {
      return { ok: false, error: `That amount is below this game's minimum ($${(MIN_GROSS_FUNDING / 1e6).toFixed(2)}).` };
    }

    const resolverOpt = await canister.get_resolver(input.collectionHex);
    if (!resolverOpt.length) return { ok: false, error: NOT_LIVE };
    const resolver = new PublicKey(resolverOpt[0]);

    // The window: from the collection itself once it exists, from now while it
    // doesn't. Guessing low here is what makes a contribution refundable before
    // the verdict it is waiting for.
    const open = await canister.get_collection(input.collectionHex);
    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    // The anchor has to be the canister's, not ours. It dates an unopened
    // collection from this contribution's birth slot through its own
    // slot→unix constants, and that reading runs ahead of wall time (see
    // `fundingCreatedAt`). Taking the later of the two is what keeps the escrow
    // outliving the window the canister will measure.
    const bySlot = BigInt(fundingCreatedAt(await connection().getSlot("finalized")));
    const anchor = open.length ? open[0].created_at : (bySlot > nowSec ? bySlot : nowSec);
    // Open collection → its own window. Not open yet → the window the recipient
    // signed, which this contribution is about to commit them to.
    const duration = open.length ? open[0].duration : BigInt(Math.max(0, Math.floor(input.durationSeconds ?? 0)));
    if (!open.length && duration === 0n) {
      return { ok: false, error: "This fundraiser has no window set — the page cannot take the first contribution." };
    }
    const votingPeriod = open.length ? open[0].voting_period : BigInt(VOTING_PERIOD);
    const deadline = anchor + duration + votingPeriod + BigInt(DEADLINE_MARGIN) + 3600n;

    const donor = new PublicKey(wallet.address);
    const nonce = BigInt(Date.now());
    const { tx, escrow } = await buildCreateEscrowTx({
      donor,
      recipient: new PublicKey(input.recipient),
      gross,
      deadline,
      resolver,
      feeBps: FEE_BPS,
      feeWallet: FEE_WALLET,
      nonce,
    });
    const txSig = await wallet.sendTransaction(tx);

    // Every contribution needs its own birth folded — the book attributes per
    // escrow, and a settlement whose escrow was never seen born is refused
    // outright rather than credited to the escrow address.
    await foldBirth(txSig, escrow.toBase58());

    // The first contribution also opens the collection, using the recipient's
    // stored signature. For every later one this answers `AlreadyExists`, which
    // is success.
    const mat = await post<{ ok: boolean; tag?: string; detail?: string }>("/api/collection/materialize", {
      collectionHex: input.collectionHex,
      escrow: escrow.toBase58(),
      donor: donor.toBase58(),
      gross: String(gross),
      deadline: String(deadline),
      nonce: String(nonce),
      createSignature: txSig,
    });
    if (!mat.ok && mat.tag !== "AlreadyExists") {
      return { ok: false, error: mat.detail || refusal(mat.tag ?? "Malformed") };
    }

    return { ok: true, escrow: escrow.toBase58(), txSig, deadline: Number(deadline) };
  } catch (e) {
    return err(e);
  }
}

/** The recipient: "delivered — judge me" / cancel-and-refund-everyone. */
export async function fundingAction(
  wallet: FlowWallet,
  collectionHex: string,
  action: "ready" | "recipient_cancel"
): Promise<FlowResult<object>> {
  try {
    const canister = await fundingCanister();
    if (!canister) return { ok: false, error: NOT_LIVE };
    // The signed word is `cancel`; the method is `recipient_cancel`. The
    // canister's own protocol spells them differently and both spellings are
    // frozen, so this is a mapping, not a choice.
    const msg = fundingMessage.action(action === "ready" ? "ready" : "cancel", collectionHex);
    const signature = await signed(wallet, msg);
    const text = request({ signedMessage: msg, pubkey: new PublicKey(wallet.address).toBytes(), signature });
    const res = action === "ready" ? await canister.ready(text) : await canister.recipient_cancel(text);
    return isAdvanced(res) ? { ok: true } : { ok: false, error: refusal(resultTag(res)) };
  } catch (e) {
    return err(e);
  }
}

export async function fundingVote(
  wallet: FlowWallet,
  collectionHex: string,
  choice: "done" | "not_done",
  recipient: string
): Promise<FlowResult<object>> {
  try {
    const canister = await fundingCanister();
    if (!canister) return { ok: false, error: NOT_LIVE };
    if (!isValidAddress(recipient)) return { ok: false, error: "This page has no valid payout address." };

    const proof = await fetchReputationProof(wallet.address, recipient);
    if (!proof) return { ok: false, error: "The book is unreachable right now — try again in a minute." };

    const msg = fundingMessage.vote(collectionHex, choice);
    const signature = await signed(wallet, msg);
    const send = async () =>
      canister.vote(
        request({
          signedMessage: msg,
          pubkey: new PublicKey(wallet.address).toBytes(),
          signature,
          extras: [["weight_witness", hex(proof.witness)]],
        })
      );

    let res = await send();
    if (resultTag(res) === "BadBirthProof") {
      await pushRoot("fundraiser");
      res = await send();
    }
    return isAdvanced(res) ? { ok: true } : { ok: false, error: refusal(resultTag(res)) };
  } catch (e) {
    return err(e);
  }
}

// ═══════════════════════════ SETTLEMENT ═══════════════════════════

/**
 * Turn a decided scope into money: pull the verdict signature once (paid, via
 * `/api/verdict`, free if the scope was already signed), then claim the escrow.
 *
 * `claim` is permissionless — anyone holding the signature can send it, and the
 * money goes where the escrow's own fields say regardless of who paid the fee.
 * That is why this is offered to whoever has the page open rather than reserved
 * for the recipient.
 *
 * The settlement transaction pays through the splitter, so its own signature is
 * what puts the donation in the book: it is folded here too, and the birth is
 * already there, which is the ordering the whole system rests on.
 */
export async function settleScope(
  wallet: FlowWallet,
  input: { game: "task" | "fundraiser"; scope: string; escrow: string; donor: string; recipient: string }
): Promise<FlowResult<{ txSig: string; outcome: number }>> {
  try {
    const v = await post<{ ok: boolean; outcome?: number; signature?: string; tag?: string; detail?: string }>(
      "/api/verdict",
      { game: input.game, scope: input.scope }
    );
    if (!v.ok || v.signature === undefined || v.outcome === undefined) {
      return { ok: false, error: v.detail || refusal(v.tag ?? "NotDecided") };
    }

    const canister = input.game === "task" ? await tasksCanister() : await fundingCanister();
    if (!canister) return { ok: false, error: NOT_LIVE };
    const resolverOpt = await canister.get_resolver(input.scope);
    if (!resolverOpt.length) return { ok: false, error: NOT_LIVE };

    const tx = buildClaimTx({
      caller: new PublicKey(wallet.address),
      escrow: new PublicKey(input.escrow),
      donor: new PublicKey(input.donor),
      recipient: new PublicKey(input.recipient),
      outcome: v.outcome === 0 ? 0 : 1,
      resolverPubkey: new PublicKey(resolverOpt[0]).toBytes(),
      signature: fromHex(v.signature),
    });
    const txSig = await wallet.sendTransaction(tx);

    // A settle pays through the splitter and therefore belongs in the book. A
    // cancel moves money back to the donor and emits nothing — there is nothing
    // to fold, and asking would be a paid read of a transaction the book has no
    // opinion about.
    if (v.outcome === 0) {
      await post("/api/ingest", { signature: txSig, escrow: input.escrow }).catch(() => {});
    }
    return { ok: true, txSig, outcome: v.outcome };
  } catch (e) {
    return err(e);
  }
}

/** The escrow address a task's fields derive to — the UI needs it to settle. */
export async function taskEscrowAddress(args: {
  donor: string;
  recipient: string;
  gross: bigint;
  deadline: bigint;
  resolver: string;
  nonce: bigint;
}): Promise<string> {
  const salt = await twoOutcomeSalt({
    donor: new PublicKey(args.donor),
    recipient: new PublicKey(args.recipient),
    gross: args.gross,
    deadline: args.deadline,
    resolver: new PublicKey(args.resolver),
    feeBps: FEE_BPS,
    feeWallet: FEE_WALLET,
    nonce: args.nonce,
  });
  return escrowPda(salt).toBase58();
}

// ═════════════════════════════ AUCTION ═════════════════════════════
//
// The auction canister exists and passed its own live run, but the first
// release is the perimeter plus conditional-tasks and conditional-funding
// (`07-build-plan.md §P8`). Its UI runs on the synced mock store, and these
// entry points stay so the pages compile and say something true rather than
// pretending to reach a chain path that is deliberately not wired.

const AUCTION_NOT_IN_RELEASE = "Auctions don't take real money yet — this one runs in demo mode.";

export async function auctionCreate(..._args: unknown[]): Promise<FlowResult<{ auctionHex: string; nonce: string }>> {
  return { ok: false, error: AUCTION_NOT_IN_RELEASE };
}
export async function auctionPlaceEntry(..._args: unknown[]): Promise<FlowResult<{ escrow: string; txSig: string; lotHex: string }>> {
  return { ok: false, error: AUCTION_NOT_IN_RELEASE };
}
export async function auctionLotAction(..._args: unknown[]): Promise<FlowResult<object>> {
  return { ok: false, error: AUCTION_NOT_IN_RELEASE };
}
export async function auctionAction(..._args: unknown[]): Promise<FlowResult<object>> {
  return { ok: false, error: AUCTION_NOT_IN_RELEASE };
}
export async function auctionVote(..._args: unknown[]): Promise<FlowResult<object>> {
  return { ok: false, error: AUCTION_NOT_IN_RELEASE };
}
