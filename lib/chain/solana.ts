import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { RPC_URL, SPLITTER, USDC_MINT } from "./config";

// One shared devnet connection. "confirmed" is enough for UX; the cheer-index
// book only ingests finalized txs anyway (its own 60s timer), so reputation
// lags the donation by ~30–90s regardless of what we pick here.
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
