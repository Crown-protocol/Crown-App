import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
} from "@solana/spl-token";
import { DS_FEE_BPS, DS_MIN_GROSS, INDEX_MIN_GROSS, FEE_WALLET, SPLITTER, USDC_DECIMALS, USDC_MINT } from "./config";
import { eventAuthority, u64le, usdcAta } from "./solana";

// ──────────────────────────────────────────────────────────────────
// direct-settlement: the plain donation, with our 2%.
//
// It is a *shape of transaction*, not a program — the game has no canister, no
// resolver and no escrow (`crown-games/direct-settlement`). Two instructions,
// both authorized by the donor's own wallet:
//
//   ix0  spl_token transferChecked  donor → fee wallet     fee
//   ix1  splitter.donate(net)       donor → recipient      net
//
// **The fee goes around the splitter, and that is load-bearing.** The splitter
// emits `Settled` on every transfer, and `Settled` is reputation — routing our
// cut through it would mint reputation for paying ourselves.
//
// Consequence the UI must state in the same words: **reputation is earned on
// `net`, not on `gross`**. The book only ever sees what went through the
// splitter. Showing the gross as "reputation earned" reads as short-changing.
//
// The 2% cannot be made mandatory and is not meant to be: the splitter is
// permissionless and pinned, so anyone may donate straight through it for 0%.
// This is the price of our client, not a toll on the road.
// ──────────────────────────────────────────────────────────────────

const DONATE_DISC = Buffer.from("79badad34946c4b4", "hex"); // sha256("global:donate")[..8]

export interface Split {
  fee: bigint;
  net: bigint;
}

/**
 * `fee = ⌊gross · fee_bps / 10000⌋`, `net = gross − fee`.
 *
 * Rounding is toward the floor, so the remainder of the division goes to the
 * recipient rather than to us — it is never more than one minor unit, and that
 * is the side of it not worth arguing about. Byte-for-byte the same arithmetic
 * as `direct_settlement_logic::split`, which the submitter re-runs on the
 * finished transaction; a divergence between the two would not fail a test, it
 * would arrive as a cycle bill.
 */
export function split(gross: bigint, feeBps: number = DS_FEE_BPS): Split {
  if (feeBps >= 10_000 || feeBps < 0) throw new Error("Bad fee.");
  const fee = (gross * BigInt(feeBps)) / 10_000n;
  return { fee, net: gross - fee };
}

export type QuoteRefusal = "GrossBelowFloor" | "NetBelowIndexFloor";

/**
 * What the donor is about to pay, checked before anything is signed.
 *
 * Two floors and they are different animals: ours (`DS_MIN_GROSS`) is the amount
 * below which folding the donation into the book costs us more than the fee
 * earns; the index's (`INDEX_MIN_GROSS`) is a dust floor applied to `net`, below
 * which the book refuses the settlement outright — no reputation, whatever we do.
 */
export function quote(gross: bigint): { ok: true; split: Split } | { ok: false; refusal: QuoteRefusal } {
  if (gross < BigInt(DS_MIN_GROSS)) return { ok: false, refusal: "GrossBelowFloor" };
  const s = split(gross);
  if (s.net < BigInt(INDEX_MIN_GROSS)) return { ok: false, refusal: "NetBelowIndexFloor" };
  return { ok: true, split: s };
}

/**
 * The whole donation transaction. Instruction order is free — a Solana
 * transaction is atomic and never half-applied — but both transfers are the
 * donor's own, and routing either through a relayer would credit the relayer in
 * the book, permanently.
 *
 * `withFee: false` builds the bare donation: the full amount straight through
 * the splitter, no cut, nothing paid to us. It is a first-class path, not a
 * loophole — the splitter is permissionless and pinned, so anyone can donate
 * that way with or without this app. What the fee buys is our side of it: the
 * name and message on the donation, the alert, the Telegram card, and the ingest
 * that puts it in the book. No fee, no service — the money still arrives in full.
 *
 * Returns the split too: the caller has to show it, and recomputing it at the
 * call site is how the two drift apart.
 */
export function buildDirectDonateTx(
  donor: PublicKey,
  recipient: PublicKey,
  gross: bigint,
  opts: { withFee?: boolean } = {}
): { tx: Transaction; split: Split } {
  const withFee = opts.withFee ?? true;
  if (!withFee) return { tx: buildFreeDonateTx(donor, recipient, gross), split: { fee: 0n, net: gross } };

  const q = quote(gross);
  if (!q.ok) {
    throw new Error(
      q.refusal === "GrossBelowFloor"
        ? `The smallest donation with a message is $${(DS_MIN_GROSS / 1e6).toFixed(2)}.`
        : "That amount is too small to carry a message."
    );
  }
  const { fee, net } = q.split;

  const donorAta = usdcAta(donor);
  const recipientAta = usdcAta(recipient);
  const feeAta = usdcAta(FEE_WALLET);
  if (donorAta.equals(recipientAta)) throw new Error("Donating to your own wallet moves nothing.");

  const tx = new Transaction();
  // Both destinations may be fresh accounts; the donor pays the rent, and an
  // idempotent create turns a confusing AccountNotFound into an honest
  // "not enough USDC" when the balance is simply zero.
  tx.add(createAssociatedTokenAccountIdempotentInstruction(donor, recipientAta, recipient, USDC_MINT));
  tx.add(createAssociatedTokenAccountIdempotentInstruction(donor, feeAta, FEE_WALLET, USDC_MINT));
  tx.add(createAssociatedTokenAccountIdempotentInstruction(donor, donorAta, donor, USDC_MINT));

  // ix0 — our cut, straight to the fee wallet, never through the splitter.
  if (fee > 0n) {
    tx.add(createTransferCheckedInstruction(donorAta, USDC_MINT, feeAta, donor, fee, USDC_DECIMALS));
  }

  // ix1 — the donation itself: donor → recipient, through the splitter, which is
  // what puts it in the book and what earns the donor their reputation.
  tx.add(
    new TransactionInstruction({
      programId: SPLITTER,
      data: Buffer.concat([DONATE_DISC, u64le(net)]),
      keys: [
        { pubkey: donor, isSigner: true, isWritable: false },
        { pubkey: donorAta, isSigner: false, isWritable: true },
        { pubkey: recipientAta, isSigner: false, isWritable: true },
        { pubkey: USDC_MINT, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: eventAuthority(), isSigner: false, isWritable: false },
        { pubkey: SPLITTER, isSigner: false, isWritable: false },
      ],
    })
  );

  return { tx, split: q.split };
}

/**
 * The bare donation: the whole amount through the splitter, no fee, no words.
 *
 * This is the same instruction the splitter has always had, and it is exactly
 * what a donor would send with no app at all. It earns the donor their
 * reputation like any settlement — but WE do not fold it into the book (the
 * platform pays only for what pays it), and it carries no name or message,
 * because the intent that would attach them is refused without a fee.
 */
export function buildFreeDonateTx(donor: PublicKey, recipient: PublicKey, gross: bigint): Transaction {
  if (gross <= 0n) throw new Error("Donation must be more than zero.");
  const donorAta = usdcAta(donor);
  const recipientAta = usdcAta(recipient);
  if (donorAta.equals(recipientAta)) throw new Error("Donating to your own wallet moves nothing.");

  const tx = new Transaction();
  tx.add(createAssociatedTokenAccountIdempotentInstruction(donor, recipientAta, recipient, USDC_MINT));
  tx.add(createAssociatedTokenAccountIdempotentInstruction(donor, donorAta, donor, USDC_MINT));
  tx.add(
    new TransactionInstruction({
      programId: SPLITTER,
      data: Buffer.concat([DONATE_DISC, u64le(gross)]),
      keys: [
        { pubkey: donor, isSigner: true, isWritable: false },
        { pubkey: donorAta, isSigner: false, isWritable: true },
        { pubkey: recipientAta, isSigner: false, isWritable: true },
        { pubkey: USDC_MINT, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: eventAuthority(), isSigner: false, isWritable: false },
        { pubkey: SPLITTER, isSigner: false, isWritable: false },
      ],
    })
  );
  return tx;
}
