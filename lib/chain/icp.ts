import { Actor, HttpAgent, type ActorSubclass } from "@dfinity/agent";
import { IDL } from "@dfinity/candid";
import { PublicKey } from "@solana/web3.js";
import { CHAIN_ID, CHEER_INDEX_PRINCIPAL, IC_HOST, isIndexConfigured } from "./config";
import { sha256 } from "./solana";

// ──────────────────────────────────────────────────────────────────
// crown-indexer: the open reputation book. Everything the browser touches here
// is a free `query` — the one non-query (`ingest`) is paid, cannot be reached
// from ingress at all (the canister's boundary is fail-closed), and lives on our
// server behind the relay: `lib/server/submitter.ts`.
//
// The Candid surface is hand-written from crown-indexer/crown-indexer.did. Two
// things about it are easy to get wrong and were, before this rewrite:
//   · `chain` is a **blob**, not text — sha256("crown-chain:v1:" ‖ id), the very
//     key the book is keyed by (`crown-games-common::field::chain_id`).
//   · reads answer with a **pair**: the value and a witness reconstructing to
//     the certified root. Decoding them as a single value fails outright.
// ──────────────────────────────────────────────────────────────────

interface BirthView {
  slot: bigint;
  donor: Uint8Array;
}

interface StateStats {
  book_keys: bigint;
  heap_bytes: bigint;
  births: bigint;
}

interface CrownIndex {
  get_reputation: (chain: Uint8Array, donor: Uint8Array, recipient: Uint8Array) => Promise<[bigint, Uint8Array]>;
  get_birth: (escrow: Uint8Array) => Promise<[[] | [BirthView], Uint8Array]>;
  get_certificate: () => Promise<[[] | [Uint8Array], Uint8Array]>;
  get_state_stats: () => Promise<StateStats>;
  get_applied_count: () => Promise<bigint>;
  get_reduce_version: () => Promise<number>;
}

const idlFactory: IDL.InterfaceFactory = ({ IDL: I }) => {
  const Birth = I.Record({ slot: I.Nat64, donor: I.Vec(I.Nat8) });
  const Stats = I.Record({ book_keys: I.Nat64, heap_bytes: I.Nat64, births: I.Nat64 });
  return I.Service({
    get_reputation: I.Func([I.Vec(I.Nat8), I.Vec(I.Nat8), I.Vec(I.Nat8)], [I.Nat, I.Vec(I.Nat8)], ["query"]),
    get_birth: I.Func([I.Vec(I.Nat8)], [I.Opt(Birth), I.Vec(I.Nat8)], ["query"]),
    get_certificate: I.Func([], [I.Opt(I.Vec(I.Nat8)), I.Vec(I.Nat8)], ["query"]),
    get_state_stats: I.Func([], [Stats], ["query"]),
    get_applied_count: I.Func([], [I.Nat64], ["query"]),
    get_reduce_version: I.Func([], [I.Nat32], ["query"]),
  });
};

let actor: ActorSubclass<CrownIndex> | null = null;

async function index(): Promise<ActorSubclass<CrownIndex> | null> {
  if (!isIndexConfigured()) return null;
  if (!actor) {
    const agent = await HttpAgent.create({ host: IC_HOST });
    // A local dfx replica self-signs; mainnet gateways must NOT fetch the root key.
    if (/localhost|127\.0\.0\.1/.test(IC_HOST)) await agent.fetchRootKey();
    actor = Actor.createActor<CrownIndex>(idlFactory, { agent, canisterId: CHEER_INDEX_PRINCIPAL });
  }
  return actor;
}

/**
 * The book's chain key: sha256("crown-chain:v1:" ‖ CHAIN_ID).
 *
 * Not a helper — it IS a third of every book key, and the games walk the index's
 * hash tree to the leaf at (chain, donor, recipient). A different derivation
 * here reads as "this donor has no reputation", never as an error.
 */
let chainKeyCache: Buffer | null = null;
export async function chainKey(): Promise<Buffer> {
  if (!chainKeyCache) {
    chainKeyCache = await sha256(Buffer.concat([Buffer.from("crown-chain:v1:", "utf8"), Buffer.from(CHAIN_ID, "utf8")]));
  }
  return chainKeyCache;
}

/**
 * Reputation of `donor` with `recipient` in USDC minor units, plus the witness
 * that proves it against the canister's certified root. `null` when the book
 * isn't reachable (unconfigured / network).
 *
 * Addresses go over the wire as RAW 32-byte pubkeys, not base58. For escrow-
 * settled donations the book already re-attributes to the funding donor — always
 * pass the wallet, never the escrow.
 */
export async function fetchReputationProof(
  donor: string,
  recipient: string
): Promise<{ value: bigint; witness: Uint8Array } | null> {
  try {
    const ix = await index();
    if (!ix) return null;
    const [value, witness] = await ix.get_reputation(
      await chainKey(),
      new PublicKey(donor).toBytes(),
      new PublicKey(recipient).toBytes()
    );
    return { value, witness };
  } catch {
    return null; // book unreachable — callers keep their mirror value
  }
}

/** Just the number, for the UI paths that show reputation and prove nothing. */
export async function fetchReputation(donor: string, recipient: string): Promise<bigint | null> {
  const r = await fetchReputationProof(donor, recipient);
  return r ? r.value : null;
}

/**
 * A recorded escrow birth plus its witness — the proof a game demands before it
 * will materialize a scope. Empty `birth` means the index has not folded the
 * `create_escrow` transaction yet: the fix is to buy that ingest
 * (`/api/ingest`), not to retry this query.
 */
export async function fetchBirthProof(
  escrow: string
): Promise<{ birth: { donor: string; slot: bigint } | null; witness: Uint8Array } | null> {
  try {
    const ix = await index();
    if (!ix) return null;
    const [opt, witness] = await ix.get_birth(new PublicKey(escrow).toBytes());
    const b = opt.length ? opt[0] : null;
    return {
      birth: b ? { donor: new PublicKey(b.donor).toBase58(), slot: b.slot } : null,
      witness,
    };
  } catch {
    return null;
  }
}

/**
 * The IC certificate over the index's certified data. A game authenticates it
 * once, on the paid `push_root`, and then admits witnesses with a hash-tree walk
 * alone — which is why this is fetched here and pushed through our server rather
 * than verified in the browser.
 */
export async function fetchCertificate(): Promise<{ cert: Uint8Array; root: Uint8Array } | null> {
  try {
    const ix = await index();
    if (!ix) return null;
    const [opt, root] = await ix.get_certificate();
    if (!opt.length) return null;
    return { cert: opt[0], root };
  } catch {
    return null;
  }
}

/** Capacity gauge + fold version, for the readiness panel. */
export async function fetchIndexStats(): Promise<
  { bookKeys: bigint; heapBytes: bigint; births: bigint; applied: bigint; reduceVersion: number } | null
> {
  try {
    const ix = await index();
    if (!ix) return null;
    const [stats, applied, reduceVersion] = await Promise.all([
      ix.get_state_stats(),
      ix.get_applied_count(),
      ix.get_reduce_version(),
    ]);
    return {
      bookKeys: stats.book_keys,
      heapBytes: stats.heap_bytes,
      births: stats.births,
      applied,
      reduceVersion,
    };
  } catch {
    return null;
  }
}
