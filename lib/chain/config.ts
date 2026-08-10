import { PublicKey } from "@solana/web3.js";

// ──────────────────────────────────────────────────────────────────
// Chain-mode target: Solana devnet + ICP canisters — the Crown perimeter.
// Every id below is pinned from the perimeter repos' own testnet profiles,
// which are the source of truth (this file is a copy, and a copy that drifts
// is a copy that silently derives addresses nothing was ever born at):
//   crown-splitter/deploy/testnet.toml            — program_id
//   crown-factory/deploy/testnet.toml             — usdc, splitter, domains
//   crown-indexer/config/testnet.toml             — chain id, splitter, factories
//   crown-games/conditional-tasks/config/testnet.toml   — fee, floors, timings
//   crown-games/conditional-funding/config/testnet.toml — verdict params
// Devnet ids are NOT frozen (upgrade authority is only burned at P8), so
// everything stays overridable via NEXT_PUBLIC_* rather than hardcoded in
// call sites. The ICP canisters have no public principals yet — those default
// to empty and gate their whole feature off.
//
// scripts/verify-chain.mjs re-reads the perimeter's own .toml/.rs files and
// fails if any constant here has drifted from them.
// ──────────────────────────────────────────────────────────────────

// The cluster id exactly as the perimeter spells it — `"devnet"`, not
// `"solana-devnet"`. It is not a label: it is a signed field of every game
// message (`chain: devnet`) and the preimage of the book's chain key, so a
// prettier spelling is a refusal at the boundary with nothing said about why.
// Mainnet cutover: NEXT_PUBLIC_CHAIN_ID="mainnet" together with the mainnet
// RPC, mint and program ids below — the whole chain layer follows.
export const CHAIN_ID = process.env.NEXT_PUBLIC_CHAIN_ID || "devnet";

export const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC || "https://api.devnet.solana.com";

// crown-splitter: one `donate(gross)` instruction, the full amount donor→
// recipient in the donor's own tx, and the `Settled` event the book folds.
// Recognition root #1 — the index counts nothing from any other program.
export const SPLITTER = new PublicKey(
  process.env.NEXT_PUBLIC_SPLITTER || "DKs2C9dRJSnZsERdD58cUVXMracvVTDS19PWvUz98GrN"
);

// Devnet USDC (6 decimals), baked into both the splitter and the factory —
// any other mint reverts at the `address = USDC_MINT` constraint.
export const USDC_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_USDC_MINT || "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
);
export const USDC_DECIMALS = 6;

// crown-factory's escrow form. `two-outcome` is the whole mainnet set (P7.9)
// and the only form anything here rides on. The `stream` form exists on devnet
// for `subscription`, and the payout-table form was deleted at P7.6 as code
// without a consumer — neither is named here, because this app has no consumer
// for either.
export const FACTORY_TWO_OUTCOME = new PublicKey(
  process.env.NEXT_PUBLIC_FACTORY_TWO_OUTCOME || "BGVQrwSwkFQspL69DjGBFgKSgL6rutPqgcgEskmi8A4y"
);

// The verdict domain the factory bakes per cluster (crown-factory/deploy/*.toml
// `[domain] two_outcome`). Byte-exact: it is the head of the message a resolver
// signs, and `claim` compares the whole thing (`assert_resolver_signed`).
export const VERDICT_DOMAIN = process.env.NEXT_PUBLIC_VERDICT_DOMAIN || `crown:two-outcome:${CHAIN_ID}`;

// The games' price list — birth fields of every escrow and part of the salt,
// so these must equal the game configs exactly or the escrow derives to an
// address whose verdict signature does not exist.
export const FEE_BPS = 300;
export const FEE_WALLET = new PublicKey(
  process.env.NEXT_PUBLIC_FEE_WALLET || "FS6ZNuPxXqWSGzwXEQpfoxikDksbEzmrXGZDFXmFj6vS"
);

// Per-game floors, measured on `gross` (USDC minor units). devnet profiles run
// cents so a live pass costs nothing; mainnet is $2.20, the economic floor from
// cost.md §5. Registration refuses below this **after** the escrow is funded,
// so the UI has to hold the same number to refuse before the money moves.
export const MIN_GROSS_TASK = 250_000;
export const MIN_GROSS_FUNDING = 250_000;

// Timings the scope ids commit (`voting_period`) and the ones registration
// validates against (`conditional-*/logic`). A deadline shorter than
// `duration + voting_period + DEADLINE_MARGIN` is refused — the margin is what
// keeps an escrow from becoming refundable before its verdict can be claimed.
export const VOTING_PERIOD = 120; // devnet; mainnet profile raises it
export const DEADLINE_MARGIN = 259_200; // 72h
export const MIN_DURATION = 60; // 1 min
export const MAX_DURATION_TASK = 2_592_000; // 30 days
export const MAX_DURATION_FUNDING = 7_776_000; // 90 days

// conditional-funding's verdict parameters — part of the `collection_id`
// preimage, so the client must derive the id with the very same numbers.
export const APPROVAL_THRESHOLD = 5_000; // strict majority, bps
export const QUORUM_WEIGHT = 150_000n;

// A vote below this weight is not admitted at the boundary (`logic::MIN_VOTE_WEIGHT`).
export const MIN_VOTE_WEIGHT = 100_000n;

// ── direct-settlement: the plain donation with our cut ─────────────────────
// The game with no canister and no escrow — a shape of transaction plus the
// submitter's policy (`crown-games/direct-settlement/docs/spec.md`). Its numbers
// deliberately live HERE rather than in the game: it ships no `config/` because
// nothing in it reads one, and its spec says the profile belongs to the client
// the day a client exists. This is that client.
export const DS_FEE_BPS = 200; // 2%, floor-rounded — the remainder goes to the recipient
export const DS_MIN_GROSS = 250_000; // devnet; mainnet is 580_000 ($0.5771)
// The index's own dust floor, applied to `net`: below it the book refuses the
// settlement, so no fee of ours can buy the donor their reputation.
export const INDEX_MIN_GROSS = 200_000;

// The splitter is a real pinned devnet program. Kept as a function because
// call sites gate on it (and env can still blank it in a pinch).
export function isSplitterConfigured() {
  return true;
}

// ──────────────────────────────────────────────────────────────────
// ICP: the crown-indexer book, the crown-relay payer, and the two MVP game
// canisters. NONE are publicly deployed yet — the perimeter's live runs
// (T5/F5) drove them on a local replica, and the games' own configs still
// carry `crown_index = "aaaaa-aa"`. Until principals + a gateway host land,
// these stay empty and every dependent feature falls back to the DB mirror.
// The moment the env vars are set, the features light up with no code change.
//
// The auction and subscription canisters exist in the perimeter but this app
// does not ship them: no principal, no client, no UI.
// ──────────────────────────────────────────────────────────────────
export const IC_HOST = process.env.NEXT_PUBLIC_IC_HOST || "";
export const CHEER_INDEX_PRINCIPAL = process.env.NEXT_PUBLIC_CHEER_INDEX_PRINCIPAL || "";
export const TASKS_PRINCIPAL = process.env.NEXT_PUBLIC_TASKS_PRINCIPAL || "";
export const FUNDING_PRINCIPAL = process.env.NEXT_PUBLIC_FUNDING_PRINCIPAL || "";

// The relay is never called from the browser: an ingress caller cannot attach
// cycles, and the relay only forwards for allowlisted keys. Paid calls (ingest,
// push_root, request_signature) go through our server — `lib/server/relay.ts`,
// whose identity is the allowlisted key. The principal is here so the readiness
// panel can show whether the paid half of the system is wired at all.
export const RELAY_PRINCIPAL = process.env.NEXT_PUBLIC_RELAY_PRINCIPAL || "";

export function isIndexConfigured() {
  return !!(IC_HOST && CHEER_INDEX_PRINCIPAL);
}

/** Both MVP games need their own canister plus the book (proofs come from it). */
export function isTasksConfigured() {
  return !!(IC_HOST && TASKS_PRINCIPAL && CHEER_INDEX_PRINCIPAL);
}
export function isFundingConfigured() {
  return !!(IC_HOST && FUNDING_PRINCIPAL && CHEER_INDEX_PRINCIPAL);
}

// Address validation — base58 ed25519 pubkeys everywhere (the 0x era is over).
export function isValidAddress(a: string): boolean {
  try {
    return new PublicKey(a.trim()).toBytes().length === 32;
  } catch {
    return false;
  }
}
