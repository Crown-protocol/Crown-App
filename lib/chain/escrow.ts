import { PublicKey, Transaction, TransactionInstruction, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import { FACTORY_TWO_OUTCOME, FEE_BPS, FEE_WALLET, SPLITTER, USDC_MINT, VERDICT_DOMAIN } from "./config";
import { eventAuthority, i64le, sha256, u16le, u64le, usdcAta, vaultAta } from "./solana";

// ──────────────────────────────────────────────────────────────────
// crown-factory primitives for the `two-outcome` form: the salt, the escrow
// PDA, the birth transaction, the ed25519 verdict and the two ways an escrow
// ends (claim on a verdict, refund after the deadline). Both MVP games —
// conditional-tasks and conditional-funding — ride on exactly this form.
//
// Everything here is byte-exact against the frozen program:
//   salt      — crown-factory/salt/src/two_outcome.rs
//   pda       — seeds ["escrow", salt] under the form's program id
//   birth ix  — shapes/two-outcome/solana/src/lib.rs::create_escrow
//   verdict   — assert_resolver_signed (domain ‖ program ‖ outcome ‖ fee)
// Get any of it wrong and the failure is quiet in the worst way: the escrow is
// born at an address whose verdict signature does not exist, and the money sits
// there until the deadline refunds it.
// ──────────────────────────────────────────────────────────────────

export interface TwoOutcomeBirth {
  donor: PublicKey;
  recipient: PublicKey;
  gross: bigint; // USDC minor units
  deadline: bigint; // unix seconds, i64
  resolver: PublicKey; // the scope's threshold-ed25519 key, from the game's get_resolver
  feeBps: number;
  feeWallet: PublicKey;
  nonce: bigint;
}

/**
 * crown-salt, two-outcome shape:
 * sha256(donor ‖ recipient ‖ gross u64LE ‖ deadline i64LE ‖ resolver ‖ fee_bps u16LE ‖ fee_wallet ‖ nonce u64LE)
 *
 * The program recomputes this hash on `create_escrow` and refuses a mismatch
 * (`SaltMismatch`), so a client that derives it differently cannot create an
 * escrow at all — the one failure mode here that is loud.
 */
export async function twoOutcomeSalt(b: TwoOutcomeBirth): Promise<Buffer> {
  return sha256(
    Buffer.concat([
      b.donor.toBuffer(),
      b.recipient.toBuffer(),
      u64le(b.gross),
      i64le(b.deadline),
      b.resolver.toBuffer(),
      u16le(b.feeBps),
      b.feeWallet.toBuffer(),
      u64le(b.nonce),
    ])
  );
}

// Escrow PDA: ["escrow", salt] under the shape's factory program.
export function escrowPda(salt: Buffer, factory: PublicKey = FACTORY_TWO_OUTCOME): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("escrow"), salt], factory)[0];
}

const CREATE_ESCROW_DISC = Buffer.from("fdd7a574246c4450", "hex"); // sha256("global:create_escrow")[..8]
const CLAIM_DISC = Buffer.from("3ec6d6c1d59f6cd2", "hex"); // sha256("global:claim")[..8]
const REFUND_DISC = Buffer.from("0260b7fb3fd02e2e", "hex"); // sha256("global:refund")[..8]

/**
 * The birth transaction for the two-outcome factory.
 *
 * Arguments, in the program's own order: **salt** · recipient · gross u64 ·
 * deadline i64 · resolver · fee_bps u16 · fee_wallet · nonce u64. The salt
 * leads, and that is not an ordering preference — the index reads a birth
 * straight out of this instruction and its only convention is `donor` at
 * account 0, `escrow` at account 1, `salt` at data bytes 8..40
 * (`crown-factory/CLAUDE.md`, checked by the form's own unit test). An
 * instruction that carries the same fields in another order funds an escrow the
 * book will never attribute.
 *
 * Accounts, `CreateEscrow` in struct order: donor(signer,w) · escrow(w) ·
 * vault(w) · donor_ata(w) · mint · token · associated-token · system. The vault
 * is `init` in the program — the factory creates it, we only pass the derived
 * address.
 */
export async function buildCreateEscrowTx(
  b: TwoOutcomeBirth
): Promise<{ tx: Transaction; escrow: PublicKey; salt: Buffer }> {
  if (b.gross <= 0n) throw new Error("Escrow must hold more than zero.");
  const salt = await twoOutcomeSalt(b);
  const escrow = escrowPda(salt);
  const donorAta = usdcAta(b.donor);

  const ix = new TransactionInstruction({
    programId: FACTORY_TWO_OUTCOME,
    data: Buffer.concat([
      CREATE_ESCROW_DISC,
      salt,
      b.recipient.toBuffer(),
      u64le(b.gross),
      i64le(b.deadline),
      b.resolver.toBuffer(),
      u16le(b.feeBps),
      b.feeWallet.toBuffer(),
      u64le(b.nonce),
    ]),
    keys: [
      { pubkey: b.donor, isSigner: true, isWritable: true }, // (0) — the index reads the donor here
      { pubkey: escrow, isSigner: false, isWritable: true }, // (1) — …and the escrow here
      { pubkey: vaultAta(escrow), isSigner: false, isWritable: true },
      { pubkey: donorAta, isSigner: false, isWritable: true },
      { pubkey: USDC_MINT, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  });

  const tx = new Transaction();
  tx.add(createAssociatedTokenAccountIdempotentInstruction(b.donor, donorAta, b.donor, USDC_MINT));
  tx.add(ix);
  return { tx, escrow, salt };
}

// Escrow account layout: Anchor discriminator sha256("account:Escrow")[..8] @0..8,
// then the header convention the index relies on — donor @8..40, salt @40..72.
const ESCROW_DISC = Buffer.from("1fd57bbbba16da9b", "hex");

export function decodeEscrow(data: Buffer): { donor: PublicKey; salt: Buffer } | null {
  if (data.length < 72 || !data.subarray(0, 8).equals(ESCROW_DISC)) return null;
  return { donor: new PublicKey(data.subarray(8, 40)), salt: Buffer.from(data.subarray(40, 72)) };
}

// ──────────────────────────────────────────────────────────────────
// The verdict: a native Ed25519Program instruction that MUST sit directly
// before `claim` — the factory reads the PREVIOUS instruction through the
// instructions sysvar, so nothing (not even a compute-budget ix) may come
// between them.
// ──────────────────────────────────────────────────────────────────
const ED25519_PROGRAM_ID = new PublicKey("Ed25519SigVerify111111111111111111111111111");
const SYSVAR_INSTRUCTIONS = new PublicKey("Sysvar1nstructions1111111111111111111111111");

export function ed25519VerdictIx(
  resolverPubkey: Uint8Array,
  signature: Uint8Array,
  message: Uint8Array
): TransactionInstruction {
  if (resolverPubkey.length !== 32 || signature.length !== 64) throw new Error("Bad verdict material.");
  const header = Buffer.concat([
    Buffer.from([1, 0]), // one signature, padding
    u16le(48), u16le(0xffff), // signature offset @48, "this instruction"
    u16le(16), u16le(0xffff), // pubkey offset @16
    u16le(112), u16le(message.length), u16le(0xffff), // message @112
  ]);
  const data = Buffer.concat([header, Buffer.from(resolverPubkey), Buffer.from(signature), Buffer.from(message)]);
  return new TransactionInstruction({ programId: ED25519_PROGRAM_ID, keys: [], data });
}

/**
 * The message a two-outcome resolver signs:
 *   VERDICT_DOMAIN ‖ program_id(32) ‖ outcome(1) ‖ fee_bps u16LE ‖ fee_wallet(32)
 *
 * The escrow address is deliberately **not** in it — one signature opens every
 * escrow of the scope, which is what makes a collection's N contributions
 * settle on one paid signature. What keeps that safe is the fee pair: the
 * program compares against the escrow's OWN `fee_bps`/`fee_wallet`, so a
 * signature cannot open an escrow born with a different price list.
 * (`assert_resolver_signed`; outcome codes settle=0 / cancel=1.)
 */
export function twoOutcomeVerdictMessage(
  outcome: 0 | 1,
  factory: PublicKey = FACTORY_TWO_OUTCOME,
  feeBps: number = FEE_BPS,
  feeWallet: PublicKey = FEE_WALLET
): Buffer {
  return Buffer.concat([
    Buffer.from(VERDICT_DOMAIN, "utf8"),
    factory.toBuffer(),
    Buffer.from([outcome]),
    u16le(feeBps),
    feeWallet.toBuffer(),
  ]);
}

/**
 * `claim(outcome)` with its verdict in front — the permissionless end of an
 * escrow. Anyone may send it once the signature is public: settle pays the fee
 * to `fee_wallet` and the net to the recipient **through the splitter** (which
 * is what puts the donation in the book), cancel returns everything to the donor.
 *
 * Accounts, `Claim` in struct order: caller(signer) · escrow(w) · vault(w) ·
 * recipient_ata(w) · fee_wallet_ata(w) · donor(w) · donor_ata(w) · mint · token ·
 * splitter · splitter event authority · instructions sysvar.
 *
 * The two ATAs the caller must have created (or that must already exist) are the
 * recipient's and the fee wallet's — the program only checks their mint and
 * owner, it does not create them, so they are added idempotently here.
 */
export function buildClaimTx(args: {
  caller: PublicKey;
  escrow: PublicKey;
  donor: PublicKey;
  recipient: PublicKey;
  outcome: 0 | 1;
  resolverPubkey: Uint8Array;
  signature: Uint8Array;
  feeBps?: number;
  feeWallet?: PublicKey;
  factory?: PublicKey;
}): Transaction {
  const factory = args.factory ?? FACTORY_TWO_OUTCOME;
  const feeWallet = args.feeWallet ?? FEE_WALLET;
  const feeBps = args.feeBps ?? FEE_BPS;
  const recipientAta = usdcAta(args.recipient);
  const feeAta = usdcAta(feeWallet);
  const donorAta = usdcAta(args.donor);

  const message = twoOutcomeVerdictMessage(args.outcome, factory, feeBps, feeWallet);

  const claimIx = new TransactionInstruction({
    programId: factory,
    data: Buffer.concat([CLAIM_DISC, Buffer.from([args.outcome])]),
    keys: [
      { pubkey: args.caller, isSigner: true, isWritable: false },
      { pubkey: args.escrow, isSigner: false, isWritable: true },
      { pubkey: vaultAta(args.escrow), isSigner: false, isWritable: true },
      { pubkey: recipientAta, isSigner: false, isWritable: true },
      { pubkey: feeAta, isSigner: false, isWritable: true },
      { pubkey: args.donor, isSigner: false, isWritable: true },
      { pubkey: donorAta, isSigner: false, isWritable: true },
      { pubkey: USDC_MINT, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SPLITTER, isSigner: false, isWritable: false },
      { pubkey: eventAuthority(), isSigner: false, isWritable: false },
      { pubkey: SYSVAR_INSTRUCTIONS, isSigner: false, isWritable: false },
    ],
  });

  const tx = new Transaction();
  // Ordinary ATA creates, before the verdict — the factory reads the instruction
  // directly preceding `claim`, so nothing may sit between those two.
  tx.add(createAssociatedTokenAccountIdempotentInstruction(args.caller, recipientAta, args.recipient, USDC_MINT));
  tx.add(createAssociatedTokenAccountIdempotentInstruction(args.caller, feeAta, feeWallet, USDC_MINT));
  tx.add(createAssociatedTokenAccountIdempotentInstruction(args.caller, donorAta, args.donor, USDC_MINT));
  tx.add(ed25519VerdictIx(args.resolverPubkey, args.signature, message));
  tx.add(claimIx);
  return tx;
}

/**
 * `refund()` — the escape hatch every escrow has: after `deadline`, with no
 * signature at all, anyone can hand the money back to the donor. This is what a
 * silent resolver degrades into, and it is why a deadline that is too tight is
 * refused at registration rather than discovered later.
 *
 * Accounts, `Refund` in struct order: caller(signer) · escrow(w) · vault(w) ·
 * donor(w) · donor_ata(w) · mint · token.
 */
export function buildRefundTx(args: {
  caller: PublicKey;
  escrow: PublicKey;
  donor: PublicKey;
  factory?: PublicKey;
}): Transaction {
  const donorAta = usdcAta(args.donor);
  const ix = new TransactionInstruction({
    programId: args.factory ?? FACTORY_TWO_OUTCOME,
    data: REFUND_DISC,
    keys: [
      { pubkey: args.caller, isSigner: true, isWritable: false },
      { pubkey: args.escrow, isSigner: false, isWritable: true },
      { pubkey: vaultAta(args.escrow), isSigner: false, isWritable: true },
      { pubkey: args.donor, isSigner: false, isWritable: true },
      { pubkey: donorAta, isSigner: false, isWritable: true },
      { pubkey: USDC_MINT, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
  });
  const tx = new Transaction();
  tx.add(createAssociatedTokenAccountIdempotentInstruction(args.caller, donorAta, args.donor, USDC_MINT));
  tx.add(ix);
  return tx;
}
