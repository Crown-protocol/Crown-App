import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";
import { SPLITTER, USDC_MINT } from "./config";
import { eventAuthority, u64le, usdcAta } from "./solana";

// Anchor discriminator sha256("global:donate")[..8] — hand-encoded rather than
// pulled from an IDL (the perimeter ships none), which is why the account list
// below is copied from the one caller that cannot be wrong: the factory's own
// CPI into the splitter (`crown-factory/shapes/two-outcome/solana/src/lib.rs`
// `splitter_donate`). If the program ever changes, the tx fails loudly with
// InvalidInstructionData rather than silently.
const DONATE_DISC = Buffer.from("79badad34946c4b4", "hex");

/**
 * The whole donate transaction:
 *   [ createATAIdempotent(recipient), createATAIdempotent(donor), donate(gross) ]
 *
 * Account order is `Donate` in struct order plus the two `#[event_cpi]` adds at
 * the end — donor · donor_ata · recipient_ata · mint · token · event_authority ·
 * splitter. The recipient's wallet is NOT an account: the splitter reads the
 * recipient off `recipient_ata.owner`, which is what the `Settled` event carries.
 *
 * The donor's own wallet signature is the ONLY auth — never route this through a
 * relayer or the `Settled` event credits the wrong payer and the donor's
 * reputation goes to it. `gross` is USDC minor units and must be > 0.
 *
 * Donor and recipient ATAs must differ: SPL Token treats a self-addressed
 * transfer as a successful no-op, so the splitter reverts it (`SelfSettlement`)
 * rather than emit an event for money that never moved.
 */
export function buildDonateTx(donor: PublicKey, recipient: PublicKey, gross: bigint): Transaction {
  if (gross <= 0n) throw new Error("Donation must be more than zero.");
  const donorAta = usdcAta(donor);
  const recipientAta = usdcAta(recipient);
  if (donorAta.equals(recipientAta)) throw new Error("Donating to your own wallet moves nothing.");

  const donateIx = new TransactionInstruction({
    programId: SPLITTER,
    data: Buffer.concat([DONATE_DISC, u64le(gross)]),
    keys: [
      { pubkey: donor, isSigner: true, isWritable: false }, // (0) payer — reputation lands here
      { pubkey: donorAta, isSigner: false, isWritable: true }, // (1)
      { pubkey: recipientAta, isSigner: false, isWritable: true }, // (2)
      { pubkey: USDC_MINT, isSigner: false, isWritable: false }, // (3)
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // (4)
      { pubkey: eventAuthority(), isSigner: false, isWritable: false }, // (5) event-CPI signer
      { pubkey: SPLITTER, isSigner: false, isWritable: false }, // (6) the program itself
    ],
  });

  const tx = new Transaction();
  // Recipient's ATA may not exist yet (fresh wallet) — idempotent create, donor pays rent.
  tx.add(createAssociatedTokenAccountIdempotentInstruction(donor, recipientAta, recipient, USDC_MINT));
  // Donor's own ATA too: turns a confusing AccountNotFound into an honest
  // "not enough USDC" when the balance is simply zero.
  tx.add(createAssociatedTokenAccountIdempotentInstruction(donor, donorAta, donor, USDC_MINT));
  tx.add(donateIx);
  return tx;
}
