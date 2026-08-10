// Hand one real devnet transaction to the local index.
//
// The index reaches Solana through the SOL RPC canister, which exists on mainnet
// and nowhere else — so locally the perimeter's own e2e mock stands at that
// pinned principal and replies with whatever was preloaded into it. This script
// is what preloads it: it fetches a REAL transaction from devnet, re-encodes it
// in the exact candid shape the index decodes (`crown-indexer/src/parse.rs`), and
// stores it as the next reply.
//
// So the local stack is not a simulation of the chain: the bytes the index folds
// are the bytes Solana produced. Only the transport is local.
//
// Usage: node feed-rpc.mjs <tx-signature>
import { Actor, HttpAgent } from "@dfinity/agent";
import { Ed25519KeyIdentity } from "@dfinity/identity";
import { IDL } from "@dfinity/candid";
import bs58 from "bs58";

const SIGNATURE = process.argv[2];
if (!SIGNATURE) {
  console.error("usage: node feed-rpc.mjs <tx-signature>");
  process.exit(1);
}

const HOST = process.env.IC_HOST || "http://127.0.0.1:4943";
const SOL_RPC = "tghme-zyaaa-aaaar-qarca-cai"; // pinned in crown-indexer/src/rpc.rs
const RPC = process.env.SOLANA_RPC || "https://api.devnet.solana.com";

// ---- the reply types, mirrored from crown-indexer/src/parse.rs ----
// Field names are the wire names (`innerInstructions`, `programIdIndex`, …): a
// misspelling here does not error, it silently drops the field and the index
// decides the transaction holds nothing it recognizes.
const Encoding = IDL.Variant({ base58: IDL.Null, base64: IDL.Null });
const EncodedTransaction = IDL.Variant({
  binary: IDL.Tuple(IDL.Text, Encoding),
  legacyBinary: IDL.Text,
});
const CompiledInstruction = IDL.Record({
  data: IDL.Text, // base58
  accounts: IDL.Vec(IDL.Nat8),
  programIdIndex: IDL.Nat8,
  stackHeight: IDL.Opt(IDL.Nat32),
});
const Instruction = IDL.Variant({ compiled: CompiledInstruction });
const InnerInstructions = IDL.Record({
  instructions: IDL.Vec(Instruction),
  index: IDL.Nat8,
});
const LoadedAddresses = IDL.Record({
  writable: IDL.Vec(IDL.Text),
  readonly: IDL.Vec(IDL.Text),
});
const TxStatus = IDL.Variant({ Ok: IDL.Null, Err: IDL.Reserved });
const TxMeta = IDL.Record({
  status: TxStatus,
  innerInstructions: IDL.Opt(IDL.Vec(InnerInstructions)),
  loadedAddresses: IDL.Opt(LoadedAddresses),
});
const EncodedTxWithMeta = IDL.Record({
  meta: IDL.Opt(TxMeta),
  transaction: EncodedTransaction,
});
const TransactionReply = IDL.Record({ slot: IDL.Nat64, transaction: EncodedTxWithMeta });
const GetTransactionResult = IDL.Variant({ Ok: IDL.Opt(TransactionReply), Err: IDL.Reserved });
const MultiGetTransactionResult = IDL.Variant({
  Consistent: GetTransactionResult,
  Inconsistent: IDL.Vec(IDL.Tuple(IDL.Reserved, GetTransactionResult)),
});

const mockIdl = ({ IDL: I }) =>
  I.Service({ set_reply: I.Func([I.Vec(I.Nat8)], [], []) });

async function rpc(method, params) {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(JSON.stringify(j.error));
  return j.result;
}

const tx = await rpc("getTransaction", [
  SIGNATURE,
  { encoding: "base64", maxSupportedTransactionVersion: 0, commitment: "finalized" },
]);
// The index asks for base58 and decodes ONLY base58 (`parse.rs`: a base64 body is
// answered with None, i.e. "unreadable"). Solana's JSON-RPC will not hand out
// base58 for a transaction, so the re-encoding happens here — the bytes are
// unchanged, only their spelling.
if (!tx) {
  console.error("no finalized transaction under that signature");
  process.exit(1);
}

const inner = (tx.meta?.innerInstructions ?? []).map((g) => ({
  index: g.index,
  instructions: g.instructions.map((ix) => ({
    compiled: {
      data: ix.data,
      accounts: ix.accounts,
      programIdIndex: ix.programIdIndex,
      // The index reads it as optional; devnet omits it on some instructions.
      stackHeight: ix.stackHeight === null || ix.stackHeight === undefined ? [] : [ix.stackHeight],
    },
  })),
}));

const loaded = tx.meta?.loadedAddresses;
const reply = {
  Consistent: {
    Ok: [
      {
        slot: BigInt(tx.slot),
        transaction: {
          meta: [
            {
              // A reverted transaction moved nothing, and the index only needs to
              // know which of the two it was.
              status: tx.meta?.err ? { Err: null } : { Ok: null },
              innerInstructions: inner.length ? [inner] : [],
              loadedAddresses:
                loaded && (loaded.writable?.length || loaded.readonly?.length)
                  ? [{ writable: loaded.writable ?? [], readonly: loaded.readonly ?? [] }]
                  : [],
            },
          ],
          transaction: { binary: [bs58.encode(Buffer.from(tx.transaction[0], "base64")), { base58: null }] },
        },
      },
    ],
  },
};

const bytes = new Uint8Array(IDL.encode([MultiGetTransactionResult], [reply]));

const agent = await HttpAgent.create({ host: HOST, identity: Ed25519KeyIdentity.generate() });
await agent.fetchRootKey();
const mock = Actor.createActor(mockIdl, { agent, canisterId: SOL_RPC });
await mock.set_reply(Array.from(bytes));

console.log(`loaded ${SIGNATURE.slice(0, 12)}… into the local SOL RPC mock`);
console.log(`  slot ${tx.slot} · ${inner.length} inner instruction group(s) · ${bytes.length} candid bytes`);
