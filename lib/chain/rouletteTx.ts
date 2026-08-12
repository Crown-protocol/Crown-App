import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { CHAIN_ID, DS_FEE_BPS, DS_MIN_GROSS } from "./config";
import { buildDirectDonateTx, type Split } from "./direct";
import { chainKey } from "./icp";
import {
  buildMemo,
  deriveEntryKey,
  deriveRoundId,
  entryFloorFromDonation,
  rlHex,
  validateAnnouncement,
  type RouletteAnnouncement,
} from "./roulette";

// ──────────────────────────────────────────────────────────────────
// A stake, and the round it belongs to — this side of the wire.
//
// The money is not the roulette's: a stake IS a `direct-settlement` donation,
// built by `direct.ts` and unchanged in every respect. What the roulette adds is
// one memo instruction binding the donation to `(round, variant)`, and that is
// the whole of its on-chain footprint.
//
// The derivations themselves live in the import-free `roulette.ts`, which
// `verify:games` executes against the crate's vectors. This file is the part
// that needs the app: wallet types, config, and the donation builder.
// ──────────────────────────────────────────────────────────────────

/** SPL Memo v2 — the program wallets and explorers already display. */
export const MEMO_PROGRAM = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

/**
 * The floor a round must publish on this cluster, measured on what the splitter
 * moves — the same number the donation floor is, seen from the other side.
 *
 * Derived here rather than written down: `DS_MIN_GROSS` is per-cluster (devnet's
 * is deliberately low), and a constant would be right on exactly one of them.
 */
export function platformWheelFloor(): bigint {
  return entryFloorFromDonation(BigInt(DS_MIN_GROSS), DS_FEE_BPS);
}

/**
 * How long before the close a client must stop taking stakes.
 *
 * The margin is for **getting into a block**, not for finality: between the
 * donor's signature and inclusion sit a wallet confirmation, the send, and the
 * wait for a leader. Finality decides when the tally has settled, not which
 * stake made the window.
 *
 * 150 slots is roughly a minute at 400ms — generous on purpose. Closing early
 * costs a minute of refused stakes; closing late costs a donor a payment that
 * reached the recipient and never reached the wheel, and that one does not come
 * back (`crown-games/roulette/docs/spec.md §Что считается ставкой`).
 */
export const STAKE_CUTOFF_SLOTS = 150;

export interface OpenRoundInput {
  /** The wallet the money goes to — the page's payout address. */
  recipient: PublicKey;
  openSlot: bigint;
  closeSlot: bigint;
  /** Minutes the recipient commits to playing the winner. */
  playMinutes: number;
  /** One word for what goes on the wheel: "game", "film", "dish". */
  topic: string;
  /** The maker's own minimum donation, if they set one above the platform's. */
  minDonation?: bigint;
  /** Tells apart concurrent rounds of the same recipient. */
  nonce: bigint;
  /**
   * Slots between knock-outs, or `0` for a single spin.
   *
   * The maker picks the format when they open the round, and it is committed
   * with everything else: a wheel already taking stakes cannot change shape.
   */
  stageSlots?: bigint;
}

/**
 * Build the announcement a recipient signs to open a wheel.
 *
 * Everything a donor plays under is in these bytes, and `round_id` is their
 * hash — so a second announcement with different rules is a different round, not
 * a rewrite of this one. That is why the whole thing is hashed rather than a
 * chosen subset of its fields: a signature can be issued twice, a hash cannot.
 */
export async function buildAnnouncement(
  input: OpenRoundInput
): Promise<{ announcement: RouletteAnnouncement; bytes: Uint8Array; roundId: Uint8Array }> {
  const floor = platformWheelFloor();
  const asked = input.minDonation ? entryFloorFromDonation(input.minDonation, DS_FEE_BPS) : 0n;
  const announcement: RouletteAnnouncement = {
    chain: new Uint8Array(await chainKey()),
    recipient: input.recipient.toBytes(),
    nonce: input.nonce,
    openSlot: input.openSlot,
    closeSlot: input.closeSlot,
    // The maker may ask for more than the network's minimum, never less.
    minGross: asked > floor ? asked : floor,
    playMinutes: BigInt(input.playMinutes),
    stageSlots: input.stageSlots ?? 0n,
    topic: new TextEncoder().encode(input.topic),
  };
  const bad = validateAnnouncement(announcement, floor);
  if (bad) throw new Error(`That round is not one the game plays: ${bad}.`);

  const bytes = (await import("./roulette")).encodeAnnouncement(announcement);
  const roundId = await deriveRoundId(announcement);
  if (!bytes || !roundId) throw new Error("That round does not encode.");
  return { announcement, bytes, roundId };
}

/** What `POST /api/roulette/round` expects, once the recipient has signed. */
export function roundPayload(input: {
  handle: string;
  roundId: Uint8Array;
  bytes: Uint8Array;
  pubkey: string;
  signature: Uint8Array;
}) {
  return {
    roundHex: rlHex(input.roundId),
    handle: input.handle,
    chain: CHAIN_ID,
    announcement: rlHex(input.bytes),
    pubkey: input.pubkey,
    signature: Buffer.from(input.signature).toString("base64"),
  };
}

/**
 * The stake transaction: the ordinary paid donation, plus the memo.
 *
 * The memo goes last and carries nothing but the two ids. It costs the donor a
 * few lamports of gas and the index nothing at all — recognition dispatches on
 * program id, so a foreign program's instruction never reaches a decoder.
 */
export async function buildStakeTx(
  donor: PublicKey,
  recipient: PublicKey,
  gross: bigint,
  roundId: Uint8Array,
  title: string
): Promise<{ tx: Transaction; split: Split; entryKey: Uint8Array; memo: string }> {
  const entryKey = await deriveEntryKey(roundId, new TextEncoder().encode(title));
  if (!entryKey) throw new Error("That title is empty or too long.");
  const memo = buildMemo(roundId, entryKey);

  const { tx, split } = buildDirectDonateTx(donor, recipient, gross);
  tx.add(
    new TransactionInstruction({
      programId: MEMO_PROGRAM,
      data: Buffer.from(memo, "utf8"),
      keys: [],
    })
  );
  return { tx, split, entryKey, memo };
}
