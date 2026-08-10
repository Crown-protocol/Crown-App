import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import bs58 from "bs58";
import { db, now } from "./db";
import { IngestResult, decodeGameReply, isRelayConfigured, submitIngest } from "./relay";

// ──────────────────────────────────────────────────────────────────
// The submitter — our half of `crown-spec/docs/07-build-plan.md §Контракт
// подающего впись`. The perimeter deliberately holds none of this: the index
// keeps no attempt budget (a self-limit in permissionless code would let anyone
// poison a stranger's signature by spending three ingests on it before
// finality), and the relay's per-key budget is a ceiling on total damage, not a
// policy. So the four rules below live here, outside the frozen code, where
// they can be changed:
//
//   1. A ceiling on retries per signature. `NotFound` before finality is normal
//      and worth retrying; `NotFound` N times in a row is worth a human, not
//      another INGEST_PRICE. A transaction whose reply does not fit the index's
//      response cap is unreadable FOREVER and looks exactly like the first case
//      — that is the attack this ceiling exists for, and it is cheap to mount.
//   2. Our own rate limit, strictly below the relay's per-key budget. Hitting
//      the relay's ceiling is an incident, not a working state: it cannot tell
//      our key from a leaked one.
//   3. We pay only for what pays us. Escrow births and the settlements a game's
//      verdict produced, plus one more: a plain donation made in the
//      `direct-settlement` shape, i.e. one that sent us our fee. A donation that
//      went straight through the splitter for 0% is refused — the splitter is
//      permissionless and that is by design, but the donor holds the reputation
//      it earns and folds it from their own budget (`00 §9`). The rule is the
//      game's own `logic::payable`, re-run here on the finished transaction.
//   4. `UnknownBirth` is an instruction, not an error: fold the escrow's birth
//      first, then re-submit the same signature. Nothing is lost meanwhile —
//      the signature stays free for anyone to fold.
// ──────────────────────────────────────────────────────────────────

/** Rule 1. Five paid reads is already a generous answer to "not finalized yet". */
const MAX_ATTEMPTS = 5;
/** Don't re-pay for the same signature faster than finality can plausibly arrive. */
const RETRY_AFTER_SECONDS = 20;
/** Rule 2. Well under any sane per-key budget; raise it only with the relay's. */
const MAX_INGESTS_PER_MINUTE = 20;

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC || "https://api.devnet.solana.com";
const FACTORY = new PublicKey(
  process.env.NEXT_PUBLIC_FACTORY_TWO_OUTCOME || "BGVQrwSwkFQspL69DjGBFgKSgL6rutPqgcgEskmi8A4y"
);
const FEE_WALLET = new PublicKey(
  process.env.NEXT_PUBLIC_FEE_WALLET || "FS6ZNuPxXqWSGzwXEQpfoxikDksbEzmrXGZDFXmFj6vS"
);
const USDC_MINT = process.env.NEXT_PUBLIC_USDC_MINT || "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

// direct-settlement's numbers (`crown-games/direct-settlement/docs/spec.md
// §Константы`; the client owns the profile, so they are the app's copy in
// lib/chain/config.ts — repeated here because a server module must not import a
// client one for two integers).
const DS_FEE_BPS = 200n;
const DS_MIN_GROSS = 250_000n; // devnet; mainnet 580_000
const INDEX_MIN_GROSS = 200_000n;

/**
 * `logic::payable` — is this settlement one we are willing to buy?
 *
 * Re-derives what the fee SHOULD have been from what actually moved, so a
 * transaction that shaved the fee is refused rather than folded at our expense.
 * The floors are two different things: ours is where the fee stops covering the
 * ingest, the index's is a dust floor on `net` below which the book refuses the
 * settlement anyway.
 */
function payable(net: bigint, feePaid: bigint): boolean {
  const gross = net + feePaid;
  const owed = (gross * DS_FEE_BPS) / 10_000n;
  return gross >= DS_MIN_GROSS && net >= INDEX_MIN_GROSS && feePaid >= owed;
}

let conn: Connection | null = null;
const rpc = () => (conn ??= new Connection(RPC_URL, "finalized"));

export type JobKind = "birth" | "settlement";

/**
 * Did this transaction pay us the fee its own settlement owes?
 *
 * Exported because two very different decisions hang off the same fact: whether
 * we buy its ingest (here), and whether we let it carry a name and a message
 * (`/api/donations/intent`). A donation that skipped the fee is welcome — the
 * splitter is permissionless — it simply gets none of our side of the service,
 * and that has to be enforced where the words are stored rather than only in the
 * UI that offers them.
 */
export async function paidOurFee(signature: string): Promise<boolean> {
  const out = await isOursToPay(signature);
  return out.ok;
}

export type IngestStatus =
  | "applied" // folded (or already folded) — terminal, the good one
  | "pending" // retriable: not finalized yet, or waiting out the backoff
  | "needs_birth" // UnknownBirth: the escrow's own birth has to be folded first
  | "exhausted" // hit the retry ceiling — a human, not another payment
  | "refused" // we will not pay for this signature (rule 3)
  | "stopped" // AfterCutover / a relay refusal: retrying cannot help
  | "unconfigured"; // no relay key — the paid half of the system isn't wired

export interface IngestOutcome {
  status: IngestStatus;
  detail: string;
  attempts: number;
}

// ---- rate limit (rule 2) ------------------------------------------------
// One process, one bucket: this counts what WE spend, so it is not per-caller.
const spent: number[] = [];
function withinOurRateLimit(): boolean {
  const cutoff = Date.now() - 60_000;
  while (spent.length && spent[0] < cutoff) spent.shift();
  return spent.length < MAX_INGESTS_PER_MINUTE;
}

// ---- rule 3: what we are willing to pay for -----------------------------

/**
 * Is this signature ours to pay for? Two ways to qualify:
 *
 *   · the two-outcome factory is in it — an escrow was born (`create_escrow`) or
 *     settled (`claim`, which pays through the splitter), i.e. game money;
 *   · or it is a `direct-settlement` donation: it paid our fee wallet at least
 *     the fee its own `net` owes (`payable`), which is exactly the condition that
 *     makes buying the ingest cost us less than the fee earned.
 *
 * Everything else — including a plain 0% donation straight through the splitter —
 * is refused. That path stays open for anyone (the splitter is permissionless by
 * design); it is simply not one the platform funds.
 *
 * Read from the chain, never from the caller: `kind` in a request body is a hint
 * for our logs, and a hint is not a permission.
 */
async function isOursToPay(signature: string): Promise<{ ok: boolean; kind?: JobKind; reason: string }> {
  let tx;
  try {
    tx = await rpc().getTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: "finalized" });
  } catch {
    return { ok: false, reason: "The transaction could not be read from the cluster." };
  }
  if (!tx) return { ok: false, reason: "No finalized transaction under that signature yet." };

  const keys = tx.transaction.message
    .getAccountKeys({ accountKeysFromLookups: tx.meta?.loadedAddresses })
    .staticAccountKeys.map((k) => k.toBase58());
  const lookups = [
    ...(tx.meta?.loadedAddresses?.writable ?? []),
    ...(tx.meta?.loadedAddresses?.readonly ?? []),
  ].map((k) => k.toBase58());
  const touched = new Set([...keys, ...lookups]);

  if (touched.has(FACTORY.toBase58())) {
    // A settlement runs the splitter through a CPI from the escrow PDA, so it has
    // inner instructions; a birth has none of the splitter in it. The distinction
    // only labels the row — both are ours to pay for.
    const inner = (tx.meta?.innerInstructions ?? []).length > 0;
    return { ok: true, kind: inner ? "settlement" : "birth", reason: "" };
  }

  // Not a game escrow — then the only thing that qualifies it is our fee.
  const feeAta = getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), FEE_WALLET).toBase58();
  const balanceOf = (list: NonNullable<typeof tx.meta>["preTokenBalances"]) =>
    BigInt(
      list?.find((b) => b.mint === USDC_MINT && b.owner === FEE_WALLET.toBase58())?.uiTokenAmount.amount ?? "0"
    );
  const feePaid = balanceOf(tx.meta?.postTokenBalances) - balanceOf(tx.meta?.preTokenBalances);
  if (feePaid <= 0n) {
    return {
      ok: false,
      reason: "A donation that paid no fee is folded by the donor, not by the platform.",
    };
  }

  // `net` is what actually went through the splitter — read from the emitted
  // event rather than inferred, because that is the number the book will credit.
  const net = settledAmount(tx);
  if (net === null) {
    return { ok: false, reason: "No settlement through the splitter in this transaction." };
  }
  if (!payable(net, feePaid)) {
    return {
      ok: false,
      reason: "This donation's fee does not cover folding it into the book.",
    };
  }
  void feeAta; // derived for symmetry with the transfer we look for; the owner match above is what decides
  return { ok: true, kind: "settlement", reason: "" };
}

// The splitter's `Settled` event, as an inner instruction of the transaction:
// event-CPI tag ‖ sha256("event:Settled")[..8] ‖ donor(32) ‖ recipient(32) ‖ gross u64LE.
const EVENT_TAG = Buffer.from("e445a52e51cb9a1d", "hex");
const SETTLED_DISC = Buffer.from("e8d228118e7c91ee", "hex");

function settledAmount(tx: NonNullable<Awaited<ReturnType<Connection["getTransaction"]>>>): bigint | null {
  for (const group of tx.meta?.innerInstructions ?? []) {
    for (const ix of group.instructions) {
      let raw: Buffer;
      try {
        raw = Buffer.from(bs58.decode((ix as { data: string }).data));
      } catch {
        continue;
      }
      if (raw.length !== 88) continue;
      if (!raw.subarray(0, 8).equals(EVENT_TAG) || !raw.subarray(8, 16).equals(SETTLED_DISC)) continue;
      return raw.readBigUInt64LE(80);
    }
  }
  return null;
}

// ---- the ledger ---------------------------------------------------------

interface Job {
  attempts: number;
  status: string;
  escrow: string | null;
  updated_at: number;
}

async function readJob(signature: string): Promise<Job | null> {
  const c = await db();
  const r = await c.execute({
    sql: `SELECT attempts, status, escrow, updated_at FROM ingest_jobs WHERE signature = ?`,
    args: [signature],
  });
  if (!r.rows.length) return null;
  const row = r.rows[0];
  return {
    attempts: Number(row.attempts),
    status: String(row.status),
    escrow: row.escrow === null ? null : String(row.escrow),
    updated_at: Number(row.updated_at),
  };
}

async function writeJob(
  signature: string,
  kind: JobKind,
  escrow: string | null,
  attempts: number,
  status: IngestStatus,
  lastResult: string
): Promise<void> {
  const c = await db();
  const t = now();
  await c.execute({
    sql: `INSERT INTO ingest_jobs (signature, kind, escrow, attempts, status, last_result, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(signature) DO UPDATE SET
            attempts = excluded.attempts,
            status = excluded.status,
            last_result = excluded.last_result,
            escrow = COALESCE(excluded.escrow, ingest_jobs.escrow),
            updated_at = excluded.updated_at`,
    args: [signature, kind, escrow, attempts, status, lastResult, t, t],
  });
}

/** The birth signature we recorded for an escrow, if we folded one. */
export async function birthSignatureOf(escrow: string): Promise<string | null> {
  const c = await db();
  const r = await c.execute({
    sql: `SELECT signature FROM ingest_jobs WHERE escrow = ? AND kind = 'birth' ORDER BY updated_at DESC LIMIT 1`,
    args: [escrow],
  });
  return r.rows.length ? String(r.rows[0].signature) : null;
}

// ---- the one entry point ------------------------------------------------

/**
 * Buy one fold of `signature`, obeying all four rules. Idempotent by design:
 * the index answers `Duplicate` free of charge for anything already folded, so a
 * double call costs nothing but a round trip.
 *
 * `escrow` is the address the signature concerns, when the caller knows it. It
 * is what makes rule 4 automatic: a settlement that comes back `UnknownBirth`
 * can be answered by folding that escrow's birth first — and after `P7.9` an
 * escrow's own donor is the only thing the book can credit it to, so getting
 * this wrong loses the donor's reputation rather than merely delaying it.
 */
export async function ingestSignature(
  signature: string,
  escrow?: string,
  depth = 0
): Promise<IngestOutcome> {
  if (!isRelayConfigured()) {
    return { status: "unconfigured", detail: "The relay key isn't configured on this deployment.", attempts: 0 };
  }

  const prior = await readJob(signature);
  if (prior?.status === "applied") return { status: "applied", detail: "Already folded.", attempts: prior.attempts };
  if (prior?.status === "stopped" || prior?.status === "refused") {
    return { status: prior.status as IngestStatus, detail: "Settled earlier — not retrying.", attempts: prior.attempts };
  }
  if (prior && prior.attempts >= MAX_ATTEMPTS) {
    return {
      status: "exhausted",
      detail: `Gave up after ${prior.attempts} paid reads — this needs a look, not another payment.`,
      attempts: prior.attempts,
    };
  }
  if (prior && now() - prior.updated_at < RETRY_AFTER_SECONDS) {
    return { status: "pending", detail: "Waiting out the backoff before paying again.", attempts: prior.attempts };
  }

  const allowed = await isOursToPay(signature);
  if (!allowed.ok) {
    // "Not finalized yet" is not a refusal — it is the normal early state, and
    // it must not be recorded as one or the retry never comes.
    if (/no finalized/i.test(allowed.reason)) {
      return { status: "pending", detail: allowed.reason, attempts: prior?.attempts ?? 0 };
    }
    await writeJob(signature, "settlement", escrow ?? null, prior?.attempts ?? 0, "refused", allowed.reason);
    return { status: "refused", detail: allowed.reason, attempts: prior?.attempts ?? 0 };
  }
  const kind = allowed.kind ?? "settlement";

  if (!withinOurRateLimit()) {
    return {
      status: "pending",
      detail: "Holding back: our own ingest rate limit, kept below the relay's per-key budget.",
      attempts: prior?.attempts ?? 0,
    };
  }

  const attempts = (prior?.attempts ?? 0) + 1;
  spent.push(Date.now());
  const out = await submitIngest(signature);
  if (!out) {
    return { status: "unconfigured", detail: "The relay isn't reachable.", attempts: attempts - 1 };
  }
  if (out.tag !== "Forwarded") {
    // A relay-level refusal never reached the index, so it costs no attempt —
    // except that retrying it blindly is what rule 2 exists to prevent.
    const stop = out.tag === "NotAllowed" || out.tag === "KeyBudgetExhausted" || out.tag === "UnknownGame";
    await writeJob(signature, kind, escrow ?? null, attempts - 1, stop ? "stopped" : "pending", out.tag);
    return {
      status: stop ? "stopped" : "pending",
      detail: `The relay refused: ${out.tag}.`,
      attempts: attempts - 1,
    };
  }

  const reply = decodeGameReply(out.reply, IngestResult);
  const tag = Object.keys(reply)[0] ?? "NotFound";

  switch (tag) {
    case "Applied":
    case "Duplicate": {
      await writeJob(signature, kind, escrow ?? null, attempts, "applied", tag);
      return { status: "applied", detail: tag, attempts };
    }
    case "UnknownBirth": {
      // Rule 4. Fold the escrow's birth, then this signature again — once, so a
      // pathological pair cannot bounce between the two forever.
      await writeJob(signature, kind, escrow ?? null, attempts, "needs_birth", tag);
      const target = escrow ?? prior?.escrow ?? null;
      const birth = target ? await birthSignatureOf(target) : null;
      if (birth && depth === 0) {
        const first = await ingestSignature(birth, target ?? undefined, depth + 1);
        if (first.status === "applied") return ingestSignature(signature, target ?? undefined, depth + 1);
      }
      return {
        status: "needs_birth",
        detail: "The index has no birth for this escrow yet — fold the create_escrow signature first.",
        attempts,
      };
    }
    case "AfterCutover": {
      await writeJob(signature, kind, escrow ?? null, attempts, "stopped", tag);
      return { status: "stopped", detail: "This transaction belongs to the next generation's book.", attempts };
    }
    case "Underpaid":
    case "LowBalance": {
      // Operational, not per-signature: the relay's price or the index's floor
      // moved under us. Retrying the same signature cannot fix either.
      await writeJob(signature, kind, escrow ?? null, attempts, "stopped", tag);
      return { status: "stopped", detail: `The index answered ${tag} — that is ours to fix, not the caller's.`, attempts };
    }
    default: {
      // NotFound — the ordinary "not finalized yet", and the ceiling's whole point.
      const status: IngestStatus = attempts >= MAX_ATTEMPTS ? "exhausted" : "pending";
      await writeJob(signature, kind, escrow ?? null, attempts, status, tag);
      return {
        status,
        detail:
          status === "exhausted"
            ? "The index could not read this transaction after repeated paid attempts."
            : "Not folded yet — the index could not read it under consensus.",
        attempts,
      };
    }
  }
}
