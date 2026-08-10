import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { RPC_URL, SPLITTER, USDC_MINT } from "./config";

// One shared devnet connection. "confirmed" is enough for UX; the book only
// folds **finalized** transactions (the index's outcall asks for finality), so
// reputation lags the donation by however long finality takes — and the ingest
// our submitter buys can only be paid for after that.
let conn: Connection | null = null;
export function connection(): Connection {
  if (!conn) conn = new Connection(RPC_URL, "confirmed");
  return conn;
}

// The splitter's event-CPI signer: PDA(["__event_authority"], splitter).
export function eventAuthority(): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], SPLITTER)[0];
}

// A wallet's USDC associated token account. allowOwnerOffCurve covers escrow
// PDAs (their ATAs are off-curve by definition).
export function usdcAta(owner: PublicKey, allowOwnerOffCurve = false): PublicKey {
  return getAssociatedTokenAddressSync(USDC_MINT, owner, allowOwnerOffCurve);
}

// An escrow's vault — the factory `init`s it as the escrow PDA's own ATA, so it
// is derivable by anyone and is never an argument the client gets to choose.
export function vaultAta(escrow: PublicKey): PublicKey {
  return usdcAta(escrow, true);
}

// ---- byte plumbing shared by the salt, the ids and the wire format ----

export async function sha256(data: Uint8Array): Promise<Buffer> {
  return Buffer.from(await crypto.subtle.digest("SHA-256", data as BufferSource));
}

export const hex = (b: Uint8Array): string =>
  Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");

export function fromHex(s: string): Buffer {
  const clean = s.trim().toLowerCase();
  if (clean.length % 2 !== 0 || /[^0-9a-f]/.test(clean)) throw new Error("Not hex.");
  return Buffer.from(clean, "hex");
}

// u64 little-endian, the only integer encoding the programs use for amounts.
export function u64le(v: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
}

export function i64le(v: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(v);
  return b;
}

export function u16le(v: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(v);
  return b;
}

// Dollars (UI) → USDC minor units (u64). Whole-dollar UI today, but rounding
// guards against float dust if cents ever appear.
export function toMinorUnits(dollars: number): bigint {
  return BigInt(Math.round(dollars * 1_000_000));
}
