import { Connection, PublicKey, type VersionedMessage } from "@solana/web3.js";
import bs58 from "bs58";
import { RPC_URL, SPLITTER, USDC_MINT } from "@/lib/chain/config";
import {
  knockOut,
  parseMemo,
  rlHex,
  spinWheel,
  tallyWheel,
  RL_MEMO_PREFIX,
  type RouletteStake,
} from "@/lib/chain/roulette";
import { decodeAnnouncement, getEntries, type StoredRound } from "./roulette";

// ──────────────────────────────────────────────────────────────────
// The wheel, read from the chain.
//
// Nothing here is a record of what we think happened: the slices come from
// transactions that paid the recipient through the pinned splitter and carried
// this round's memo, the weights come from the splitter's own `Settled`, and the
// seed comes from a block nobody in the game chose. The showcase is a
// reader of this, never its author — which is why the same numbers can be
// recomputed by a stranger with an RPC url and `crown-games/roulette/logic`.
//
// Read at `finalized`, like the index: a stake that a reorg could still undo is
// not a stake yet.
// ──────────────────────────────────────────────────────────────────

const MEMO_PROGRAM = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

/**
 * Anchor's `emit_cpi!` tag followed by the `Settled` event discriminator —
 * `sha256("event:Settled")[..8]`, the same two constants `crown-indexer`
 * recognizes on (`src/recognize.rs`).
 *
 * The event body is `donor(32) ‖ recipient(32) ‖ gross u64le`, so a `Settled`
 * instruction is 88 bytes exactly.
 */
const SETTLED_PREFIX = Buffer.from("e445a52e51cb9a1de8d228118e7c91ee", "hex");
const SETTLED_LEN = 16 + 32 + 32 + 8;

/** How many signatures of the recipient's token account we will walk back. */
const MAX_SIGNATURES = 600;
/** How far above the close we look for a produced block. */
const BEACON_SEARCH_SLOTS = 300;

let conn: Connection | null = null;
function rpc(): Connection {
  if (!conn) conn = new Connection(RPC_URL, "finalized");
  return conn;
}

export interface WheelSlice {
  /** `entry_key`, hex. The identity of the slice; the title is decoration. */
  key: string;
  /** Σ of what the splitter moved toward it, minor units, as a decimal string. */
  weight: string;
  /** `null` when the title is unknown here — nobody published it, or it is hidden. */
  title: string | null;
  /**
   * True when the maker hid it. Kept apart from a plain `null` because the two
   * are different facts and a viewer deserves the right one: "nobody named this
   * slice" and "the maker took the name down" are not the same event.
   */
  hidden: boolean;
  /** Knocked out at some stage of an elimination round. */
  out: boolean;
  /**
   * First staked after an elimination round's field was fixed at the close: on
   * the wheel, not in the running. Always `false` on a single-spin round.
   */
  late: boolean;
}

/**
 * One transaction this round's rules were applied to — the evidence, not the
 * conclusion.
 *
 * Returned so the verification page can recompute the winner from rows a reader
 * can open in an explorer, instead of being handed a total and asked to believe
 * it. Every field here is something the chain says; `counted` is the only
 * judgement, and it is one the reader can re-make from the other three.
 */
export interface StakeEvidence {
  signature: string;
  slot: number;
  /** `entry_key` from the memo, hex. */
  key: string;
  /** What the splitter moved to the recipient, minor units, decimal string. */
  moved: string;
  counted: boolean;
}

/** One knock-out of an elimination round, with the block that decided it. */
export interface Stage {
  stage: number;
  slot: number;
  beacon: { slot: number; hash: string };
  /** `entry_key` hex of the slice this stage removed. */
  out: string;
}

export interface ChainWheel {
  roundHex: string;
  slices: WheelSlice[];
  total: string;
  /** Transactions that counted, and transactions that carried this round's memo but did not. */
  counted: number;
  excluded: number;
  /**
   * True when the walk hit its cap before reaching the round's open slot, i.e.
   * the set below may be short. Reported rather than hidden: a wheel that is
   * quietly missing a slice is worse than one that says it might be.
   */
  truncated: boolean;
  /** `null` while the round is still open. */
  beacon: { slot: number; hash: string } | null;
  /** `entry_key` hex of the winner, once the beacon exists. */
  winner: string | null;
  /**
   * Knock-outs so far. Empty on a single-spin round, and on an elimination round
   * that has not reached its first stage.
   */
  stages: Stage[];
  /** Slots between knock-outs; `0` means one spin decides it. */
  stageSlots: number;
  /**
   * The finalized slot at the moment of the read.
   *
   * Returned so the countdown on screen is measured against the **same** clock
   * the tally used. A client polling its own `getSlot` would drift from this one
   * and could show a window still open after the wheel had already closed.
   */
  currentSlot: number;
  /** Present only when asked for: the per-transaction evidence behind the slices. */
  stakes?: StakeEvidence[];
}

/**
 * Σ of what the pinned splitter reported moving to `recipient` in this
 * transaction, or `null` if it reported nothing — i.e. this is not a settlement
 * at all and therefore not a stake.
 *
 * The splitter's `Settled` rides as an event-CPI, so it lives in the inner
 * instructions, never among the outer ones.
 */
function settledTo(
  tx: NonNullable<Awaited<ReturnType<Connection["getTransaction"]>>>,
  keys: ReturnType<VersionedMessage["getAccountKeys"]>,
  recipient: string
): bigint | null {
  let total: bigint | null = null;
  for (const group of tx.meta?.innerInstructions ?? []) {
    for (const ix of group.instructions) {
      if (!keys.get(ix.programIdIndex)?.equals(SPLITTER)) continue;
      let data: Buffer;
      try {
        data = Buffer.from(bs58.decode(ix.data));
      } catch {
        continue;
      }
      if (data.length !== SETTLED_LEN || !data.subarray(0, 16).equals(SETTLED_PREFIX)) continue;
      const to = new PublicKey(data.subarray(48, 80)).toBase58();
      if (to !== recipient) continue;
      total = (total ?? 0n) + data.readBigUInt64LE(80);
    }
  }
  return total;
}

/**
 * Walk the recipient's USDC account back to the round's open slot and keep what
 * this round's rules count as a stake.
 *
 * The rule is the spec's, applied in the spec's order: in the window, memo of
 * this round, settled to this recipient by the pinned splitter, and at or above
 * the round's floor. The amount comes from the splitter's own `Settled`, never
 * from the memo or a label — a memo can say anything, and what it says about
 * money is not evidence.
 */
async function readStakes(
  round: StoredRound,
  minGross: bigint,
  windowEnd: number
): Promise<{
  stakes: RouletteStake[];
  evidence: StakeEvidence[];
  counted: number;
  excluded: number;
  truncated: boolean;
}> {
  const recipient = new PublicKey(round.recipient);
  const { getAssociatedTokenAddressSync } = await import("@solana/spl-token");
  const ata = getAssociatedTokenAddressSync(USDC_MINT, recipient);

  const stakes: RouletteStake[] = [];
  const evidence: StakeEvidence[] = [];
  let counted = 0;
  let excluded = 0;
  let truncated = false;
  let before: string | undefined;
  let walked = 0;

  outer: while (walked < MAX_SIGNATURES) {
    const page = await rpc().getSignaturesForAddress(ata, { before, limit: 100 }, "finalized");
    if (!page.length) break;
    for (const s of page) {
      walked++;
      // Signatures come newest-first, so once we are below the open slot there
      // is nothing older left to find.
      if (s.slot < round.openSlot) break outer;
      before = s.signature;
      if (s.err) continue;

      // The listing already carries the memo, and skipping on it here is what
      // keeps this read from being an asymmetry: without it, any stranger could
      // make every wheel read cost a `getTransaction` per dust transfer they sent
      // to the recipient's token account — cents for them, six hundred RPC calls
      // for us. A transaction with no roulette memo cannot be a stake, and now it
      // costs nothing to say so.
      if (!s.memo?.includes(RL_MEMO_PREFIX)) continue;

      const tx = await rpc().getTransaction(s.signature, {
        maxSupportedTransactionVersion: 0,
        commitment: "finalized",
      });
      if (!tx) continue;

      const keys = tx.transaction.message.getAccountKeys({
        accountKeysFromLookups: tx.meta?.loadedAddresses,
      });
      let tag = null;
      for (const ix of tx.transaction.message.compiledInstructions) {
        if (keys.get(ix.programIdIndex)?.equals(MEMO_PROGRAM)) {
          tag = parseMemo(new Uint8Array(ix.data));
        }
      }
      if (!tag || rlHex(tag.roundId) !== round.roundHex) continue;

      // **The money must have gone through the pinned splitter**, and the weight
      // is what the splitter says it moved — not the recipient's balance delta.
      //
      // The two coincide on an honest stake, but they are different rules, and
      // for this game that is the whole ballgame: a verifier implementing the
      // spec would refuse a plain transfer carrying this round's memo, while a
      // balance delta would count it. Two rules, two wheels, one of them wrong.
      //
      // Authenticity comes from the program id: an event-CPI can only be emitted
      // by the program itself, and the splitter is pinned and immutable. The
      // index additionally pairs each event with an executed `TransferChecked` —
      // that check protects the *book* from an event without money, and
      // re-implementing it here would be a second copy of the law
      // (`games-harness` §Что такое игра). The splitter's own `out == in` is what
      // this rule leans on instead.
      const moved = settledTo(tx, keys, round.recipient);
      if (moved === null) continue;

      // `windowEnd` is the close on a single-spin round and the last stage on an
      // elimination one: giving between knock-outs has to count, or the format's
      // whole point ("defend what you backed") is decoration.
      const inWindow = s.slot >= round.openSlot && s.slot < windowEnd;
      const ok = inWindow && moved >= minGross;
      evidence.push({
        signature: s.signature,
        slot: s.slot,
        key: rlHex(tag.entryKey),
        moved: moved.toString(),
        counted: ok,
      });
      if (ok) {
        stakes.push({ key: tag.entryKey, gross: moved });
        counted++;
      } else {
        // Counted separately rather than dropped silently: a donor whose stake
        // arrived a second late is owed an explanation, not an absence.
        excluded++;
      }
    }
    if (walked >= MAX_SIGNATURES) truncated = true;
  }
  // Oldest-first: the chain hands them newest-first, and a reader checking a
  // round follows it forward in time, not backwards.
  evidence.reverse();
  return { stakes, evidence, counted, excluded, truncated };
}

/**
 * The beacon: the blockhash of the first **produced** block at or above the
 * round's close slot. `null` while the round is still open, or while that block
 * has not been finalized yet — an unfinalized seed is a seed that can still
 * change, and the wheel must not spin on one.
 */
export async function readBeacon(
  closeSlot: number,
  knownSlot?: number
): Promise<{ slot: number; hash: string } | null> {
  const current = knownSlot ?? (await rpc().getSlot("finalized"));
  if (current < closeSlot) return null;
  const produced = await rpc().getBlocks(closeSlot, Math.min(closeSlot + BEACON_SEARCH_SLOTS, current));
  const slot = produced[0];
  if (slot === undefined) return null;
  const block = await rpc().getBlock(slot, {
    transactionDetails: "none",
    rewards: false,
    maxSupportedTransactionVersion: 0,
  });
  return block ? { slot, hash: block.blockhash } : null;
}

// ---- read cache -----------------------------------------------------------
//
// One wheel read walks the chain: a page of signatures plus a `getTransaction`
// per stake. The endpoint that serves it is public and every viewer polls it, so
// without this a busy round multiplies straight into upstream RPC calls — and an
// anonymous caller could run that bill up on purpose.
//
// The TTL is short (one poll interval) rather than clever, and hiding a title
// invalidates explicitly, so moderation is never waiting on a clock.
const CACHE_TTL_MS = 5_000;
const cache = new Map<string, { at: number; value: ChainWheel }>();

export function invalidateWheel(roundHex: string): void {
  for (const k of [...cache.keys()]) if (k.startsWith(roundHex)) cache.delete(k);
}

/** The whole round as the chain shows it: slices, odds, and — once closed — the winner. */
export async function readWheel(round: StoredRound, detail = false): Promise<ChainWheel | null> {
  const key = `${round.roundHex}:${detail ? "d" : ""}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  const fresh = await readWheelUncached(round, detail);
  if (fresh) {
    cache.set(key, { at: Date.now(), value: fresh });
    // The map is keyed per round and rounds are few; this keeps a long-lived
    // process from holding every round it ever served.
    if (cache.size > 200) for (const k of [...cache.keys()].slice(0, 100)) cache.delete(k);
  }
  return fresh;
}

async function readWheelUncached(round: StoredRound, detail: boolean): Promise<ChainWheel | null> {
  const announcement = decodeAnnouncement(round.announcement);
  if (!announcement) return null;

  const stageSlots = Number(announcement.stageSlots);
  const currentSlot = await rpc().getSlot("finalized");
  const roundId = Uint8Array.from(Buffer.from(round.roundHex, "hex"));

  // An elimination round keeps taking stakes between knock-outs, so its window
  // runs to now rather than to the close.
  const windowEnd = stageSlots > 0 ? currentSlot + 1 : round.closeSlot;
  const { stakes, evidence, counted, excluded, truncated } = await readStakes(
    round,
    announcement.minGross,
    windowEnd
  );
  const titles = await getEntries(round.roundHex);

  // Stakes with their slots, so each stage can be rebuilt as it stood then.
  const timed = evidence
    .filter((e) => e.counted)
    .map((e) => ({ key: e.key, gross: BigInt(e.moved), slot: e.slot }));
  const at = (slot: number, exclude: Set<string>): RouletteStake[] =>
    timed
      .filter((t) => t.slot < slot && !exclude.has(t.key))
      .map((t) => ({ key: Uint8Array.from(Buffer.from(t.key, "hex")), gross: t.gross }));

  const wheel = tallyWheel(stakes, announcement.minGross);
  const stages: Stage[] = [];
  const gone = new Set<string>();
  /** Empty on a single-spin round, where every slice is in the running. */
  let field = new Set<string>();
  let winner: string | null = null;
  let beacon: { slot: number; hash: string } | null = null;

  if (stageSlots === 0) {
    beacon = await readBeacon(round.closeSlot, currentSlot);
    if (beacon) {
      const verdict = await spinWheel(roundId, bs58.decode(beacon.hash), wheel);
      if (verdict.kind === "winner") winner = rlHex(verdict.key);
    }
  } else {
    // The field is whatever stood on the wheel at the close. After that money can
    // change a slice's odds of surviving but cannot add a slice — otherwise a
    // round could never end, because a fresh title would always be one more to
    // knock out.
    field = new Set(
      tallyWheel(at(round.closeSlot, gone), announcement.minGross).slices.map((s) => rlHex(s.key))
    );
    const inField = (ex: Set<string>) =>
      at(currentSlot + 1, ex).filter((s) => field.has(rlHex(s.key)));

    // Walk the stages the chain has actually reached. Each one takes its own
    // beacon, so a donation landing between two of them lands in the next one's
    // weights — which is the format.
    for (let k = 0; k < field.size; k++) {
      const slot = round.closeSlot + k * stageSlots;
      if (currentSlot < slot) break;
      const alive = tallyWheel(
        at(slot, gone).filter((s) => field.has(rlHex(s.key))),
        announcement.minGross
      );
      if (alive.slices.length < 2) break;
      const b = await readBeacon(slot, currentSlot);
      if (!b) break;
      const out = await knockOut(roundId, bs58.decode(b.hash), k, alive);
      if (!out) break;
      gone.add(rlHex(out));
      stages.push({ stage: k, slot, beacon: b, out: rlHex(out) });
      beacon = b;
    }
    const left = tallyWheel(inField(gone), announcement.minGross);
    if (field.size > 0 && left.slices.length === 1) winner = rlHex(left.slices[0].key);
  }

  return {
    roundHex: round.roundHex,
    slices: wheel.slices.map((s) => ({
      key: rlHex(s.key),
      weight: s.weight.toString(),
      title: titles.titles[rlHex(s.key)] ?? null,
      hidden: titles.hidden.includes(rlHex(s.key)),
      out: gone.has(rlHex(s.key)),
      // A title that first appeared after the close of an elimination round.
      // The money reached the recipient, but the field was already fixed — so it
      // is on the wheel and not in the running, and says so rather than sitting
      // there looking like a contender.
      late: stageSlots > 0 && !field.has(rlHex(s.key)),
    })),
    total: wheel.total.toString(),
    counted,
    excluded,
    truncated,
    beacon,
    winner,
    currentSlot,
    stages,
    stageSlots,
    ...(detail ? { stakes: evidence } : {}),
  };
}
