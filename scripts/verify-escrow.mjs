// Structural devnet check of the CLIENT-SIDE create_escrow encoding (lib/chain/escrow.ts)
// against the DEPLOYED two-outcome factory: build the exact tx the UI would send and
// SIMULATE it. We can't fund escrows from CI (no devnet USDC faucet automation), so the
// pass condition is honest and structural, mirroring verify-chain's donate check:
//   • the factory DECODES the instruction (no InstructionDidNotDeserialize / fallback), and
//   • execution then dies where money should be: token balance / missing donor ATA funds.
// A wrong discriminator, argument order or account order fails loudly here.
// Run: node scripts/verify-escrow.mjs
import { createHash, randomBytes } from "node:crypto";
import { PublicKey, Transaction, TransactionInstruction, SystemProgram } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";

const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC || "https://api.devnet.solana.com";
const FACTORY = new PublicKey(process.env.NEXT_PUBLIC_FACTORY_TWO_OUTCOME || "83f7ziVs5VeQ8xiDka8zczbfJT4WcxsXQ18cqWwmV5ur");
const USDC = new PublicKey(process.env.NEXT_PUBLIC_USDC_MINT || "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const FEE_WALLET = new PublicKey("3it64t7KXNip1C1BRYNh8ygeKyujWnaQrPSj3hV9TWbE");

let failed = 0;
const check = (name, ok, got = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : ` — ${got}`}`);
  if (!ok) failed++;
};

const sha8 = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const u64le = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
const i64le = (v) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(v)); return b; };
const u16le = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };

// crown-salt (two-outcome) — must equal lib/chain/escrow.ts twoOutcomeSalt
function salt(b) {
  return createHash("sha256")
    .update(Buffer.concat([b.donor.toBuffer(), b.streamer.toBuffer(), u64le(b.gross), i64le(b.deadline), b.resolver.toBuffer(), u16le(b.feeBps), b.feeWallet.toBuffer(), u64le(b.nonce)]))
    .digest();
}

const rpc = async (method, params) => {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(JSON.stringify(j.error));
  return j.result;
};

// Pinned test vector from Crown-Factory/vectors (same one verify-chain checks).
const vec = salt({
  donor: new PublicKey(Buffer.alloc(32, 0x11)),
  streamer: new PublicKey(Buffer.alloc(32, 0x22)),
  gross: 1_000_000n,
  deadline: 1_900_000_000n,
  resolver: new PublicKey(Buffer.alloc(32, 0x33)),
  feeBps: 500,
  feeWallet: new PublicKey(Buffer.alloc(32, 0x44)),
  nonce: 7n,
});
check("crown-salt matches the pinned vector", vec.toString("hex") === "149c82b09a080ef4c92921d13d974177bfea2dd546ef8b798627e3e4245afe6b", vec.toString("hex"));
check("create_escrow discriminator derives", sha8("global:create_escrow") === "fdd7a574246c4450", sha8("global:create_escrow"));

// Donor for the SIMULATION: a funded devnet account (the fee wallet holds SOL), impersonated
// with sigVerify:false — the point is to exercise the factory's decode+execute path, and a
// zero-lamport fee payer dies at "AccountNotFound" before the program even runs.
const donor = { publicKey: FEE_WALLET };
const birth = {
  donor: donor.publicKey,
  streamer: new PublicKey("4Ss5JMkXAD9Z7cktFEdrqeMuT6jGMF1pVozTyPHZ6zT4"),
  gross: 5_000_000n,
  deadline: BigInt(Math.floor(Date.now() / 1000) + 86_400),
  resolver: new PublicKey(randomBytes(32)), // any ed25519 point is a valid resolver key at birth
  feeBps: 300,
  feeWallet: FEE_WALLET,
  nonce: BigInt(Date.now()),
};
const s = salt(birth);
const escrow = PublicKey.findProgramAddressSync([Buffer.from("escrow"), s], FACTORY)[0];
const donorAta = getAssociatedTokenAddressSync(USDC, donor.publicKey);
const escrowAta = getAssociatedTokenAddressSync(USDC, escrow, true);

const ix = new TransactionInstruction({
  programId: FACTORY,
  data: Buffer.concat([
    Buffer.from("fdd7a574246c4450", "hex"),
    u64le(birth.gross), i64le(birth.deadline), birth.resolver.toBuffer(), u16le(birth.feeBps), birth.feeWallet.toBuffer(), u64le(birth.nonce),
  ]),
  keys: [
    { pubkey: birth.donor, isSigner: true, isWritable: true },
    { pubkey: birth.streamer, isSigner: false, isWritable: false },
    { pubkey: USDC, isSigner: false, isWritable: false },
    { pubkey: escrow, isSigner: false, isWritable: true },
    { pubkey: donorAta, isSigner: false, isWritable: true },
    { pubkey: escrowAta, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
});

const tx = new Transaction();
tx.add(createAssociatedTokenAccountIdempotentInstruction(donor.publicKey, donorAta, donor.publicKey, USDC));
tx.add(ix);
tx.feePayer = donor.publicKey;
const bh = await rpc("getLatestBlockhash", [{ commitment: "confirmed" }]);
tx.recentBlockhash = bh.value.blockhash;

const wire = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
const sim = await rpc("simulateTransaction", [wire, { encoding: "base64", commitment: "confirmed", sigVerify: false, replaceRecentBlockhash: true }]);
const logs = (sim.value.logs ?? []).join("\n");
console.log("── sim logs (tail):");
console.log((sim.value.logs ?? []).slice(-6).join("\n"));

const decodeFailure = /InstructionDidNotDeserialize|Fallback functions are not supported|InvalidInstructionData|Instruction discriminator not provided/i.test(logs);
check("factory DECODES our create_escrow (no deserialize/fallback error)", !decodeFailure, "encoding mismatch — see logs");
// Best case: the donor account holds devnet USDC and the whole escrow EXECUTES in simulation
// (factory logs success, err null). Acceptable case: it dies at money (no USDC / no lamports)
// AFTER decoding. Either way the client encoding matches the deployed program.
const fullSuccess = sim.value.err === null && /Program 83f7[\s\S]*success/.test(logs);
const reachedMoney = /insufficient|debit an account|Error: Account not associated|custom program error: 0x1\b/i.test(logs + JSON.stringify(sim.value.err ?? ""));
check(
  fullSuccess ? "escrow EXECUTES end-to-end in simulation (donor had devnet USDC)" : "execution dies at MONEY, not at structure",
  fullSuccess || reachedMoney,
  JSON.stringify(sim.value.err)
);

console.log(failed ? `\n${failed} FAILED` : "\nВСЕ ПРОВЕРКИ ПРОШЛИ");
process.exit(failed ? 1 : 0);
