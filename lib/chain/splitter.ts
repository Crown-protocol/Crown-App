import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";
import { SPLITTER, USDC_MINT } from "./config";
import { eventAuthority, u64le, usdcAta } from "./solana";

// Anchor discriminator sha256("global:donate")[..8] — pinned from
// Cheer-Core/contracts/solana (verified against the repo's own byte dump).
// If the program ever changes, the tx fails loudly with InvalidInstructionData,
// not silently — hand-encoding without an IDL is a deliberate trade the
// backend also makes in Cheer-Bot-TG's core/.
const DONATE_DISC = Buffer.from("79badad34946c4b4", "hex");

/**
 * The whole donate transaction, exactly as Cheer-Core's examples build it:
 *   [ createATAIdempotent(streamer), createATAIdempotent(donor), donate(gross) ]
 * The donor's own wallet signature is the ONLY auth — never route this through
 * a relayer or the Settled event credits the wrong payer and the donor's
 * reputation is stolen. gross is USDC minor units and must be > 0.
 */
export function buildDonateTx(donor: PublicKey, streamer: PublicKey, gross: bigint): Transaction {
  if (gross <= 0n) throw new Error("Donation must be more than zero.");
  const donorAta = usdcAta(donor);
  const streamerAta = usdcAta(streamer);

  const donateIx = new TransactionInstruction({
    programId: SPLITTER,
    data: Buffer.concat([DONATE_DISC, u64le(gross)]),
    keys: [
      { pubkey: donor, isSigner: true, isWritable: false }, // (0) payer — reputation lands here
      { pubkey: streamer, isSigner: false, isWritable: false }, // (1)
      { pubkey: USDC_MINT, isSigner: false, isWritable: false }, // (2)
      { pubkey: donorAta, isSigner: false, isWritable: true }, // (3)
      { pubkey: streamerAta, isSigner: false, isWritable: true }, // (4)
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // (5)
      { pubkey: eventAuthority(), isSigner: false, isWritable: false }, // (6)
      { pubkey: SPLITTER, isSigner: false, isWritable: false }, // (7)
    ],
  });

  const tx = new Transaction();
  // Streamer's ATA may not exist yet (fresh wallet) — idempotent create, donor pays rent.
  tx.add(createAssociatedTokenAccountIdempotentInstruction(donor, streamerAta, streamer, USDC_MINT));
  // Donor's own ATA too: turns a confusing AccountNotFound into an honest
  // "not enough USDC" when the balance is simply zero.
  tx.add(createAssociatedTokenAccountIdempotentInstruction(donor, donorAta, donor, USDC_MINT));
  tx.add(donateIx);
  return tx;
}
