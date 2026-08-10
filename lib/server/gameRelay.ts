import { fetchCertificate } from "@/lib/chain/icp";
import {
  CollectionResult,
  TaskResult,
  fundingCanister,
  tasksCanister,
} from "@/lib/chain/games";
import { CHAIN_ID, FUNDING_PRINCIPAL, TASKS_PRINCIPAL } from "@/lib/chain/config";
import {
  decodeGameReply,
  encodePushRoot,
  encodeRequestSignature,
  isRelayConfigured,
  submitGameCall,
} from "./relay";

// ──────────────────────────────────────────────────────────────────
// The two paid pulls of a game, on the server because they cost cycles and the
// relay only pays for its allowlisted key:
//
//   push_root(cert)              — authenticate a fresh index root (two BLS
//                                  pairings) and cache it, so the game's free
//                                  boundary can admit birth and weight proofs
//                                  with a hash-tree walk alone.
//   request_signature(chain, s)  — the scope's resolver signs the finalized
//                                  verdict. One signature per scope, reused by
//                                  every escrow of it.
//
// Both are memoised on the game's side: a scope already signed is served free
// from its store, so the honest order is "ask the free query first, pay only if
// it is empty". That is what `verdictOf` does — the relay recharges full price
// for a call it forwards, whatever the game then answers.
// ──────────────────────────────────────────────────────────────────

export type GameName = "task" | "fundraiser";

const principalOf = (game: GameName) => (game === "task" ? TASKS_PRINCIPAL : FUNDING_PRINCIPAL);
const resultTypeOf = (game: GameName) => (game === "task" ? TaskResult : CollectionResult);

export interface PaidOutcome {
  ok: boolean;
  tag: string;
  detail?: string;
}

function notWired(): PaidOutcome {
  return { ok: false, tag: "Unconfigured", detail: "The paid half of the system isn't wired on this deployment." };
}

/**
 * Push the index's current certificate into a game. Idempotent and cheap to
 * repeat in the sense that matters — a root already cached is simply cached
 * again — but it is a PAID call every time, so callers should push on a proof
 * refusal (`BadBirthProof`) rather than before every action.
 */
export async function pushRoot(game: GameName): Promise<PaidOutcome> {
  if (!isRelayConfigured()) return notWired();
  const principal = principalOf(game);
  if (!principal) return notWired();

  const cert = await fetchCertificate();
  if (!cert) return { ok: false, tag: "NoCertificate", detail: "The index did not answer with a certificate." };

  const out = await submitGameCall(principal, "PushRoot", encodePushRoot(cert.cert));
  if (!out) return notWired();
  if (out.tag !== "Forwarded") return { ok: false, tag: out.tag, detail: `The relay refused: ${out.tag}.` };

  const reply = decodeGameReply(out.reply, resultTypeOf(game));
  const tag = Object.keys(reply)[0] ?? "Malformed";
  return { ok: tag === "RootPushed", tag };
}

export interface Verdict {
  outcome: number; // settle = 0, cancel/refund = 1
  signature: Uint8Array; // the resolver's threshold signature over the verdict message
}

/**
 * The scope's verdict signature — free from the game's store if it has already
 * been produced, bought through the relay if not.
 *
 * `NotDecided` is not a failure: it means the scope has not finished (the
 * deadline has not passed, the vote is still open). The caller shows that as
 * "not yet", and nothing was charged for it.
 */
export async function verdictOf(
  game: GameName,
  scope: string
): Promise<{ verdict?: Verdict } & PaidOutcome> {
  const principal = principalOf(game);
  if (!principal) return notWired();

  // Free first — the threshold signature is deterministic in (scope, outcome),
  // so buying it twice buys the same bytes.
  const actor = game === "task" ? await tasksCanister() : await fundingCanister();
  if (actor) {
    const cached = await actor.get_signature(scope);
    if (cached.length) {
      return { ok: true, tag: "Signed", verdict: { outcome: cached[0].outcome, signature: cached[0].signature } };
    }
  }

  if (!isRelayConfigured()) return notWired();
  const out = await submitGameCall(principal, "RequestSignature", encodeRequestSignature(CHAIN_ID, scope));
  if (!out) return notWired();
  if (out.tag !== "Forwarded") return { ok: false, tag: out.tag, detail: `The relay refused: ${out.tag}.` };

  const reply = decodeGameReply(out.reply, resultTypeOf(game)) as Record<string, { signature: Uint8Array; outcome: number }>;
  const tag = Object.keys(reply)[0] ?? "Malformed";
  if (tag === "Signed") {
    const v = reply.Signed;
    return { ok: true, tag, verdict: { outcome: v.outcome, signature: new Uint8Array(v.signature) } };
  }
  if (tag === "SignInFlight") {
    // A sibling call is already signing this scope — free, and the bytes land in
    // the store. Ask again in a moment rather than paying a second time.
    return { ok: false, tag, detail: "The signature is already being produced — try again shortly." };
  }
  return { ok: false, tag, detail: tag === "NotDecided" ? "This scope has not been decided yet." : undefined };
}
