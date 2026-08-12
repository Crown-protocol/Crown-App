import bs58 from "bs58";
import nacl from "tweetnacl";
import { PublicKey } from "@solana/web3.js";
import { db, now } from "./db";
import { pushRoot, type GameName } from "./gameRelay";
import { ingestSignature } from "./submitter";
import { fetchBirthProof } from "@/lib/chain/icp";
import { fundingCanister, isAdvanced, resultTag } from "@/lib/chain/games";
import { fields } from "@/lib/chain/wire";
import { hex } from "@/lib/chain/solana";

// ──────────────────────────────────────────────────────────────────
// Collections are created lazily and by two different people at two different
// times: the recipient signs the `create` message when they open the collection,
// but the canister will not accept it until a donor's first contribution exists
// on chain and its birth is folded into the book. This module is the gap
// between those two moments.
//
// What is stored is the recipient's own signed message — public bytes that
// authorize exactly one thing. What is added later is the unsigned half the
// canister cross-checks against the birth proof anyway: donor, gross, deadline,
// nonce, witness.
// ──────────────────────────────────────────────────────────────────

export interface CollectionIntent {
  collectionHex: string;
  recipient: string;
  recipientNonce: string;
  duration: number;
  goal: string;
  signedMessage: string;
  pubkey: string;
  signature: string;
  materializedAt: number | null;
}

/**
 * Record a recipient's signed `create`. The signature is verified here, against
 * the message as stored: a row that cannot authorize its own message is a row
 * that fails later, at the one moment nobody is watching — a donor's first
 * contribution.
 */
export async function saveCollectionIntent(i: Omit<CollectionIntent, "materializedAt">): Promise<boolean> {
  let ok = false;
  try {
    const pk = new PublicKey(i.pubkey).toBytes();
    const sig = bs58.decode(i.signature);
    ok = nacl.sign.detached.verify(new TextEncoder().encode(i.signedMessage), sig, pk);
    // The signer must be the recipient — the canister takes `req.pubkey` as the
    // collection's recipient, so a row signed by anyone else opens a collection
    // that pays someone else.
    ok = ok && new PublicKey(i.pubkey).toBase58() === new PublicKey(i.recipient).toBase58();
  } catch {
    ok = false;
  }
  if (!ok) return false;

  const c = await db();
  await c.execute({
    sql: `INSERT INTO collection_intents
            (collection_hex, recipient, recipient_nonce, duration, goal, signed_message, pubkey, signature, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(collection_hex) DO NOTHING`,
    args: [
      i.collectionHex,
      i.recipient,
      i.recipientNonce,
      i.duration,
      i.goal,
      i.signedMessage,
      i.pubkey,
      i.signature,
      now(),
    ],
  });
  return true;
}

export async function getCollectionIntent(collectionHex: string): Promise<CollectionIntent | null> {
  const c = await db();
  const r = await c.execute({
    sql: `SELECT * FROM collection_intents WHERE collection_hex = ?`,
    args: [collectionHex],
  });
  if (!r.rows.length) return null;
  const row = r.rows[0] as unknown as Record<string, string | number | null>;
  return {
    collectionHex: String(row.collection_hex),
    recipient: String(row.recipient),
    recipientNonce: String(row.recipient_nonce),
    duration: Number(row.duration),
    goal: String(row.goal),
    signedMessage: String(row.signed_message),
    pubkey: String(row.pubkey),
    signature: String(row.signature),
    materializedAt: row.materialized_at === null ? null : Number(row.materialized_at),
  };
}

export interface MaterializeInput {
  collectionHex: string;
  escrow: string;
  donor: string;
  gross: string;
  deadline: string;
  nonce: string;
  createSignature: string; // the Solana tx that gave birth to the escrow
}

export interface MaterializeOutcome {
  ok: boolean;
  tag: string;
  detail?: string;
}

/**
 * Spend a stored `create` against a real birth: fold the contribution's birth,
 * refresh the game's root, take the witness and send the recipient's message
 * with the birth-proof extras attached.
 *
 * Ordinary outcomes that are NOT failures:
 *   · `AlreadyExists` — someone else's contribution materialized it first. The
 *     collection is open, which is all the caller wanted.
 *   · a birth that has not been folded yet — the caller retries; the escrow's
 *     money is untouched either way.
 */
export async function materializeCollection(input: MaterializeInput): Promise<MaterializeOutcome> {
  const intent = await getCollectionIntent(input.collectionHex);
  if (!intent) return { ok: false, tag: "NoIntent", detail: "No collection was opened under that id." };

  const canister = await fundingCanister();
  if (!canister) return { ok: false, tag: "Unconfigured", detail: "The funding canister isn't configured." };

  // Already open? Then there is nothing to spend the intent on.
  const existing = await canister.get_collection(input.collectionHex);
  if (existing.length) {
    await markMaterialized(input.collectionHex);
    return { ok: true, tag: "AlreadyExists" };
  }

  // The birth has to be in the book before the game can be shown a witness for it.
  const fold = await ingestSignature(input.createSignature, input.escrow);
  if (fold.status !== "applied") {
    return { ok: false, tag: fold.status, detail: fold.detail };
  }

  const attempt = async (): Promise<MaterializeOutcome> => {
    const proof = await fetchBirthProof(input.escrow);
    if (!proof || !proof.birth) {
      return { ok: false, tag: "NoBirth", detail: "The index has no birth recorded for this escrow yet." };
    }
    const text = `${intent.signedMessage}\n---\n${fields([
      ["pubkey", intent.pubkey],
      ["signature", intent.signature],
      ["recipient_nonce", intent.recipientNonce],
      ["donor", input.donor],
      ["gross", input.gross],
      ["deadline", input.deadline],
      ["nonce", input.nonce],
      ["witness", hex(proof.witness)],
    ])}`;
    try {
      const res = await canister.create_collection(text);
      return { ok: isAdvanced(res), tag: resultTag(res) };
    } catch (e) {
      // The game's anonymous boundary does not *answer* a witness it cannot walk
      // — it refuses the ingress before execution, so this arrives as a thrown
      // rejection rather than as a `BadBirthProof` variant. Both mean the same
      // thing and both are fixed by the same paid push; catching it here is what
      // turns a 500 in front of a donor whose money already moved into the retry
      // that was always meant to happen.
      const why = e instanceof Error ? e.message : String(e);
      return { ok: false, tag: /reject/i.test(why) ? "BadBirthProof" : "CallFailed", detail: why.slice(0, 200) };
    }
  };

  // Push first, then take the witness — and be ready to do it again.
  //
  // The witness the index hands out reconstructs against its root **as of now**,
  // and that root keeps moving: the mirror indexer folds settlements in the
  // background, so a witness taken a moment after a push can already belong to a
  // newer root than the one the game cached. The game then refuses it, the
  // caller pushes, takes a fresh witness — and can lose the same race again.
  // Pushing before each attempt shrinks the window to a single call, and three
  // attempts make losing it three times in a row the only way to fail. A push
  // costs `root_price` cycles; a donor whose money is in an escrow attached to
  // no collection costs a great deal more.
  let out: MaterializeOutcome = { ok: false, tag: "NotAttempted" };
  for (let i = 0; i < 3; i++) {
    const pushed = await pushRoot("fundraiser" as GameName);
    if (!pushed.ok && i === 0) return { ok: false, tag: "RootPushFailed", detail: pushed.detail };
    out = await attempt();
    if (out.ok || out.tag === "AlreadyExists" || out.tag === "NoBirth") break;
  }
  if (out.ok || out.tag === "AlreadyExists") await markMaterialized(input.collectionHex);
  return out.tag === "AlreadyExists" ? { ok: true, tag: out.tag } : out;
}

async function markMaterialized(collectionHex: string): Promise<void> {
  const c = await db();
  await c.execute({
    sql: `UPDATE collection_intents SET materialized_at = ? WHERE collection_hex = ? AND materialized_at IS NULL`,
    args: [now(), collectionHex],
  });
}
