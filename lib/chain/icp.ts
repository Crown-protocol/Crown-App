import { Actor, HttpAgent, type ActorSubclass } from "@dfinity/agent";
import { IDL } from "@dfinity/candid";
import { PublicKey } from "@solana/web3.js";
import { CHAIN_ID, CHEER_INDEX_PRINCIPAL, IC_HOST, isIndexConfigured } from "./config";

// ──────────────────────────────────────────────────────────────────
// cheer-index: the open reputation book. Query-only, free, no auth —
// (chain, payer, streamer) → Σ honestly-paid USDC minor units.
// Candid surface hand-written from Cheer-Core/index/cheer-index.did
// (no generated bindings are committed in the backend repo).
// The canister has NO public principal yet (S4 deferred): every entry
// point below no-ops until NEXT_PUBLIC_IC_HOST + _CHEER_INDEX_PRINCIPAL
// are set — at which point this lights up without a code change.
// ──────────────────────────────────────────────────────────────────

interface CheerIndex {
  get_reputation: (chain: string, payer: Uint8Array, streamer: Uint8Array) => Promise<bigint>;
  get_cursor: (chain: string) => Promise<[] | [string]>;
  ingest_hint: () => Promise<void>;
}

const idlFactory: IDL.InterfaceFactory = ({ IDL: I }) =>
  I.Service({
    get_reputation: I.Func([I.Text, I.Vec(I.Nat8), I.Vec(I.Nat8)], [I.Nat], ["query"]),
    get_cursor: I.Func([I.Text], [I.Opt(I.Text)], ["query"]),
    ingest_hint: I.Func([], [], []),
  });

let actor: ActorSubclass<CheerIndex> | null = null;

async function cheerIndex(): Promise<ActorSubclass<CheerIndex> | null> {
  if (!isIndexConfigured()) return null;
  if (!actor) {
    const agent = await HttpAgent.create({ host: IC_HOST });
    // A local dfx replica self-signs; mainnet gateways must NOT fetch the root key.
    if (/localhost|127\.0\.0\.1/.test(IC_HOST)) await agent.fetchRootKey();
    actor = Actor.createActor<CheerIndex>(idlFactory, { agent, canisterId: CHEER_INDEX_PRINCIPAL });
  }
  return actor;
}

/**
 * Reputation of `payer` with `streamer` in USDC minor units, or null when the
 * book isn't reachable (unconfigured / network). Addresses go over the wire
 * as RAW 32-byte pubkeys, not base58 text. For escrow-settled donations the
 * book already re-attributes to the donor wallet — always pass the wallet.
 */
export async function fetchReputation(payer: string, streamer: string): Promise<bigint | null> {
  try {
    const ix = await cheerIndex();
    if (!ix) return null;
    return await ix.get_reputation(CHAIN_ID, new PublicKey(payer).toBytes(), new PublicKey(streamer).toBytes());
  } catch {
    return null; // book unreachable — callers keep their mock/last-known value
  }
}

// Last finalized signature the book has ingested — lets the UI show a donation
// as "pending" until the 60s ingest timer catches up (~30–90s after confirm).
export async function fetchCursor(): Promise<string | null> {
  try {
    const ix = await cheerIndex();
    if (!ix) return null;
    const c = await ix.get_cursor(CHAIN_ID);
    return c.length ? c[0] : null;
  } catch {
    return null;
  }
}

// The empty alarm bell (core-spec §5): rings the book right after a finalized
// donation so the record lands in seconds instead of the watchdog's minute cadence.
// Unauthorized by design and unable to affect the book's CONTENT — safe to fire blind.
export async function ingestHint(): Promise<void> {
  try {
    const ix = await cheerIndex();
    if (!ix) return;
    await ix.ingest_hint();
  } catch {}
}
