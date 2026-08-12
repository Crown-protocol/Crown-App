import { createHash } from "node:crypto";
import nacl from "tweetnacl";
import { PublicKey } from "@solana/web3.js";
import { db } from "./db";
import { getProfileOwner } from "./store";
import {
  decodeAnnouncement as decodeBytes,
  deriveEntryKey,
  deriveRoundId,
  rlFromHex,
  rlHex,
  type RouletteAnnouncement,
} from "@/lib/chain/roulette";

// ──────────────────────────────────────────────────────────────────
// Rounds and the titles behind their slices.
//
// This module stores two things and is the authority over neither, which is the
// whole reason the roulette can be verified without us:
//
//   · a ROUND is the canonical announcement bytes plus the recipient's signature
//     over them. `round_hex` is their hash, so a row cannot disagree with its own
//     id; the signature is checked here and re-checkable by anyone afterwards.
//   · an ENTRY is a title. `entry_hex` is its hash under the round, so a wrong
//     preimage does not hash and is refused — which is exactly why this needs no
//     signature: there is nothing to forge, only something to compute.
//
// The wheel itself is never stored. It is tallied from the chain (see
// `rouletteChain.ts`), and the verdict is computed over keys, never over the
// words kept here. Losing this table costs the round its names, not its winner.
// ──────────────────────────────────────────────────────────────────

/**
 * Ceiling on stored titles per round. Not a product limit — a bound on a table
 * an anonymous caller can write to (see [`saveEntry`]). Far above any real
 * wheel, where every slice costs a donation.
 */
export const MAX_TITLES_PER_ROUND = 500;

export interface StoredRound {
  roundHex: string;
  handle: string;
  chain: string;
  recipient: string;
  /** Canonical announcement bytes, hex — the preimage of `roundHex`. */
  announcement: string;
  pubkey: string;
  /** base64 ed25519 over the announcement bytes. */
  signature: string;
  openSlot: number;
  closeSlot: number;
  createdAt: number;
}

export type SaveRoundError =
  | "bad-announcement"
  | "id-mismatch"
  | "chain-mismatch"
  | "bad-signature"
  | "not-the-owner"
  | "exists";

function fromHex(s: string): Uint8Array {
  return rlFromHex(s) ?? new Uint8Array();
}

/**
 * Decode the stored hex back into the announcement it encodes. The decoder
 * itself lives beside its encoder in `lib/chain/roulette.ts`; this is only the
 * hex wrapper the DB layer needs.
 */
export function decodeAnnouncement(hex: string): RouletteAnnouncement | null {
  const bytes = rlFromHex(hex);
  return bytes ? decodeBytes(bytes) : null;
}

/**
 * Store a round, or say why it is not one.
 *
 * Five refusals, and only one of them is a policy: the bytes must decode, they
 * must hash to the id claimed, the cluster label must be the cluster the bytes
 * commit, and the signature over them must verify. The fifth — the signer is the
 * page's owner — is the only one about us, and without it a stranger could hang a
 * wheel on someone else's page.
 */
export async function saveRound(input: {
  roundHex: string;
  handle: string;
  chain: string;
  announcement: string;
  pubkey: string;
  signature: string;
}): Promise<{ ok: true } | { ok: false; error: SaveRoundError }> {
  const roundHex = input.roundHex.trim().toLowerCase();
  const announcement = input.announcement.trim().toLowerCase();
  const decoded = decodeAnnouncement(announcement);
  if (!decoded) return { ok: false, error: "bad-announcement" };

  const derived = await deriveRoundId(decoded);
  if (!derived || rlHex(derived) !== roundHex) return { ok: false, error: "id-mismatch" };

  // The `chain` column is a label the caller sends; the announcement commits the
  // book's chain key. Unchecked, a row could read "devnet" over rules that were
  // signed for mainnet — a lie nobody would catch, because everything downstream
  // reads the label and the verifier reads the bytes.
  const expected = createHash("sha256").update(`crown-chain:v1:${input.chain}`).digest("hex");
  if (rlHex(decoded.chain) !== expected) return { ok: false, error: "chain-mismatch" };

  let ok = false;
  try {
    ok = nacl.sign.detached.verify(
      fromHex(announcement),
      Uint8Array.from(Buffer.from(input.signature, "base64")),
      new PublicKey(input.pubkey).toBytes()
    );
  } catch {
    ok = false;
  }
  if (!ok) return { ok: false, error: "bad-signature" };

  const owner = await getProfileOwner(input.handle);
  if (owner && owner !== input.pubkey) return { ok: false, error: "not-the-owner" };

  const c = await db();
  const existing = await c.execute({
    sql: `SELECT round_hex FROM roulette_rounds WHERE round_hex = ?`,
    args: [roundHex],
  });
  // A round is immutable: its id is the hash of everything it says, so a second
  // write under the same id could only be the same bytes anyway.
  if (existing.rows.length) return { ok: false, error: "exists" };

  await c.execute({
    sql: `INSERT INTO roulette_rounds
            (round_hex, handle, chain, recipient, announcement, pubkey, signature, open_slot, close_slot, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      roundHex,
      input.handle,
      input.chain,
      new PublicKey(decoded.recipient).toBase58(),
      announcement,
      input.pubkey,
      input.signature,
      Number(decoded.openSlot),
      Number(decoded.closeSlot),
      Date.now(),
    ],
  });
  return { ok: true };
}

function toRound(r: Record<string, unknown>): StoredRound {
  return {
    roundHex: String(r.round_hex),
    handle: String(r.handle),
    chain: String(r.chain),
    recipient: String(r.recipient),
    announcement: String(r.announcement),
    pubkey: String(r.pubkey),
    signature: String(r.signature),
    openSlot: Number(r.open_slot),
    closeSlot: Number(r.close_slot),
    createdAt: Number(r.created_at),
  };
}

export async function getRound(roundHex: string): Promise<StoredRound | null> {
  const c = await db();
  const r = await c.execute({
    sql: `SELECT * FROM roulette_rounds WHERE round_hex = ?`,
    args: [roundHex.trim().toLowerCase()],
  });
  return r.rows.length ? toRound(r.rows[0] as unknown as Record<string, unknown>) : null;
}

/** Newest first — a page can have run many wheels, and the latest is the live one. */
export async function listRounds(handle: string, limit = 20): Promise<StoredRound[]> {
  const c = await db();
  const r = await c.execute({
    sql: `SELECT * FROM roulette_rounds WHERE handle = ? ORDER BY close_slot DESC LIMIT ?`,
    args: [handle, Math.min(Math.max(limit, 1), 100)],
  });
  return r.rows.map((row) => toRound(row as unknown as Record<string, unknown>));
}

/**
 * Attach a title to a slice.
 *
 * Open to anyone, deliberately: a memo can be built by any client, so the person
 * holding a preimage is not always the person who runs the page. What keeps it
 * honest is that the title is *checked by hashing*, not by trusting the caller —
 * and a slice whose preimage nobody publishes is an ordinary case that shows as
 * its short key, not an error (spec §Тексты).
 */
export async function saveEntry(input: {
  roundHex: string;
  entryHex: string;
  title: string;
}): Promise<boolean> {
  const roundHex = input.roundHex.trim().toLowerCase();
  const entryHex = input.entryHex.trim().toLowerCase();
  const round = await getRound(roundHex);
  if (!round) return false;

  const key = await deriveEntryKey(fromHex(roundHex), new TextEncoder().encode(input.title));
  if (!key || rlHex(key) !== entryHex) return false;

  const c = await db();
  // A title is accepted for a key that hashes — **not** for a key that is on the
  // wheel. That is deliberate (a stake can be seen before its slice is read back
  // from the chain, and any client may publish a preimage), but it means an
  // anonymous caller can mint rows for slices nobody ever staked: hash a word,
  // post it, repeat. The words never reach the wheel — the wheel looks titles up
  // BY the keys it already has — but the table would grow without anything real
  // behind it, which is the one shape this architecture refuses everywhere else.
  //
  // So the round carries a ceiling. It sits far above any real wheel: every true
  // slice costs a donation at or above the floor, and a round with five hundred
  // of them has never happened.
  const known = await c.execute({
    sql: `SELECT COUNT(*) AS n FROM roulette_entries WHERE round_hex = ?`,
    args: [roundHex],
  });
  if (Number(known.rows[0]?.n ?? 0) >= MAX_TITLES_PER_ROUND) {
    const mine = await c.execute({
      sql: `SELECT 1 FROM roulette_entries WHERE round_hex = ? AND entry_hex = ?`,
      args: [roundHex, entryHex],
    });
    // An already-stored title is idempotent and must keep working at the cap;
    // only a NEW one is refused.
    if (!mine.rows.length) return false;
  }
  await c.execute({
    sql: `INSERT INTO roulette_entries (round_hex, entry_hex, title, created_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(round_hex, entry_hex) DO NOTHING`,
    args: [roundHex, entryHex, input.title, Date.now()],
  });
  return true;
}

export interface EntryTitles {
  /** Slice → title. A hidden slice is **absent** here, not blanked. */
  titles: Record<string, string>;
  /** Slices the maker has hidden — named, so "hidden" reads differently from "nobody published one". */
  hidden: string[];
}

/**
 * Titles for a round, as the public may see them.
 *
 * A hidden title never enters this object, so it cannot leak through a
 * component that forgot to check a flag: the only safe way to not show a word is
 * to not send it. What is sent instead is the key, which the reader could have
 * derived from the chain anyway.
 */
export async function getEntries(roundHex: string): Promise<EntryTitles> {
  const c = await db();
  const r = await c.execute({
    sql: `SELECT entry_hex, title, hidden FROM roulette_entries WHERE round_hex = ?`,
    args: [roundHex.trim().toLowerCase()],
  });
  const titles: Record<string, string> = {};
  const hidden: string[] = [];
  for (const row of r.rows) {
    const key = String(row.entry_hex);
    if (Number(row.hidden)) hidden.push(key);
    else titles[key] = String(row.title);
  }
  return { titles, hidden };
}

/** Every title including the hidden ones — for the maker's own screen only. */
export async function getEntriesForOwner(roundHex: string): Promise<EntryTitles> {
  const c = await db();
  const r = await c.execute({
    sql: `SELECT entry_hex, title, hidden FROM roulette_entries WHERE round_hex = ?`,
    args: [roundHex.trim().toLowerCase()],
  });
  const titles: Record<string, string> = {};
  const hidden: string[] = [];
  for (const row of r.rows) {
    const key = String(row.entry_hex);
    titles[key] = String(row.title);
    if (Number(row.hidden)) hidden.push(key);
  }
  return { titles, hidden };
}

/**
 * Hide or unhide one slice's title. Returns the round's handle so the caller can
 * check the signer owns it, or `null` if there is no such round.
 *
 * Deliberately reversible: this is moderation, and moderation that cannot be
 * undone is a mistake nobody can take back.
 */
export async function setEntryHidden(
  roundHex: string,
  entryHex: string,
  hidden: boolean
): Promise<string | null> {
  const round = await getRound(roundHex);
  if (!round) return null;
  const c = await db();
  await c.execute({
    sql: `UPDATE roulette_entries SET hidden = ? WHERE round_hex = ? AND entry_hex = ?`,
    args: [hidden ? 1 : 0, roundHex.trim().toLowerCase(), entryHex.trim().toLowerCase()],
  });
  return round.handle;
}
