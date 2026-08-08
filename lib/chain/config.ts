import { PublicKey } from "@solana/web3.js";

// ──────────────────────────────────────────────────────────────────
// Chain-mode target: Solana devnet + ICP canisters (the Cheer backend).
// Every id below is pinned from the backend repos' testnet profiles:
//   Cheer-Core/config/testnet.toml      — splitter, usdc
//   Cheer-Factory/deploy/testnet.toml   — the three escrow factories
//   Conditional-*/config/testnet.toml   — fee_bps, fee_wallet, min_gross
// Devnet ids are NOT frozen (upgrade authority is only burned at F6), so
// everything stays overridable via NEXT_PUBLIC_* env rather than hardcoded
// in call sites. The ICP canisters have no public principals yet (S4
// deferred) — those default to empty and gate their whole feature off.
// ──────────────────────────────────────────────────────────────────

// The exact chain-id string every canister call and verdict domain uses.
// Env-driven for the mainnet cutover (deploy/mainnet.toml fills at F6): set
// NEXT_PUBLIC_CHAIN_ID="solana-mainnet" together with the mainnet RPC, mint
// and program ids below — the whole chain layer follows with no code change.
export const CHAIN_ID = process.env.NEXT_PUBLIC_CHAIN_ID || "solana-devnet";

export const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC || "https://api.devnet.solana.com";

// Cheer-Core's splitter: one donate(gross) instruction, the full amount
// donor→streamer in the donor's own tx (fees live in the game escrows, not here).
export const SPLITTER = new PublicKey(process.env.NEXT_PUBLIC_SPLITTER || "DDSeyx684iU9agHbXExwS3NstLvQeLKZcJWcJFSh1VDA");

// Circle native devnet USDC (6 decimals). Baked into the splitter binary —
// any other mint reverts with WrongMint; bridged USDC is forbidden.
export const USDC_MINT = new PublicKey(process.env.NEXT_PUBLIC_USDC_MINT || "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
export const USDC_DECIMALS = 6;

// Cheer-Factory escrow shapes (each program id IS the factory).
export const FACTORY_TWO_OUTCOME = new PublicKey(process.env.NEXT_PUBLIC_FACTORY_TWO_OUTCOME || "83f7ziVs5VeQ8xiDka8zczbfJT4WcxsXQ18cqWwmV5ur");
export const FACTORY_PAYOUT_TABLE = new PublicKey(process.env.NEXT_PUBLIC_FACTORY_PAYOUT_TABLE || "EzvxRLxLvPW6TdmVCQ2JBWiv37tCD6kSngNvS2z2D3ka");
export const FACTORY_STREAM = new PublicKey(process.env.NEXT_PUBLIC_FACTORY_STREAM || "57MpCQ3TfAE66qDAnfkP9AX7LRqwd4CNX8uN6DaVwm3V");

// The games' price tag (factory-spec §2.1): birth fields of every escrow,
// part of the cheer-salt. Wrong values → an unresolvable escrow, so these
// mirror the game configs exactly.
export const FEE_BPS = 300;
export const FEE_WALLET = new PublicKey(process.env.NEXT_PUBLIC_FEE_WALLET || "3it64t7KXNip1C1BRYNh8ygeKyujWnaQrPSj3hV9TWbE");
// Dust floor for game escrows (Conditional-Tasks testnet profile pins 34).
export const MIN_GROSS_TASK = 34;

// The splitter is a real pinned devnet program now. Kept as a function
// because call sites gate on it (and env can still blank it in a pinch).
export function isSplitterConfigured() {
  return true;
}

// ──────────────────────────────────────────────────────────────────
// ICP: the cheer-index reputation book + per-game resolver canisters.
// NONE are publicly deployed yet — they run only on the backend dev's local
// replica (S4 deferred). Until he hands over principals + a gateway host,
// these stay empty and every dependent feature falls back to mock. The
// moment the env vars are set, the features light up without a code change.
// ──────────────────────────────────────────────────────────────────
export const IC_HOST = process.env.NEXT_PUBLIC_IC_HOST || "";
export const CHEER_INDEX_PRINCIPAL = process.env.NEXT_PUBLIC_CHEER_INDEX_PRINCIPAL || "";
export const TASKS_PRINCIPAL = process.env.NEXT_PUBLIC_TASKS_PRINCIPAL || "";
export const FUNDING_PRINCIPAL = process.env.NEXT_PUBLIC_FUNDING_PRINCIPAL || "";
export const AUCTION_PRINCIPAL = process.env.NEXT_PUBLIC_AUCTION_PRINCIPAL || "";
export const SUBSCRIPTION_PRINCIPAL = process.env.NEXT_PUBLIC_SUBSCRIPTION_PRINCIPAL || "";

export function isIndexConfigured() {
  return !!(IC_HOST && CHEER_INDEX_PRINCIPAL);
}

// Address validation — base58 ed25519 pubkeys everywhere (the 0x era is over).
export function isValidAddress(a: string): boolean {
  try {
    return new PublicKey(a.trim()).toBytes().length === 32;
  } catch {
    return false;
  }
}
