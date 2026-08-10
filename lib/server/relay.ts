import { Actor, HttpAgent, type ActorSubclass, type Identity } from "@dfinity/agent";
import { Ed25519KeyIdentity } from "@dfinity/identity";
import { IDL } from "@dfinity/candid";
import { Principal } from "@dfinity/principal";

// ──────────────────────────────────────────────────────────────────
// crown-relay client — the ONLY door to the perimeter's paid calls, and a
// server-side one by construction: an ingress caller cannot attach cycles, so
// the relay pays out of its own budget and only for keys on its allowlist. Our
// key is that allowlisted key. It never reaches the browser.
//
// The relay fronts exactly three calls and the set is closed by its own type:
//   Ingest(signature)                    → index.ingest, INGEST_PRICE
//   Game{RequestSignature, game, arg}    → game.request_signature, SIGN_PRICE
//   Game{PushRoot, game, arg}            → game.push_root, ROOT_PRICE
// Price is a function of the call, never an argument — so nothing here chooses
// what it pays, and a `Forwarded` reply carries the downstream answer verbatim.
// ──────────────────────────────────────────────────────────────────

const IC_HOST = process.env.IC_HOST || process.env.NEXT_PUBLIC_IC_HOST || "";
const RELAY_PRINCIPAL = process.env.RELAY_PRINCIPAL || process.env.NEXT_PUBLIC_RELAY_PRINCIPAL || "";
// The allowlisted key, as the JSON `Ed25519KeyIdentity.toJSON()` produces.
// Server-only env (no NEXT_PUBLIC_): a leaked key spends the relay's budget up
// to its per-key ceiling, which is precisely the loss that ceiling bounds.
const RELAY_KEY = process.env.RELAY_IDENTITY_JSON || "";

export function isRelayConfigured(): boolean {
  return !!(IC_HOST && RELAY_PRINCIPAL && RELAY_KEY);
}

const GameCall = IDL.Variant({ RequestSignature: IDL.Null, PushRoot: IDL.Null });
const GameReq = IDL.Record({ arg: IDL.Vec(IDL.Nat8), call: GameCall, game: IDL.Principal });
const Request = IDL.Variant({ Game: GameReq, Ingest: IDL.Text });
const SubmitResult = IDL.Variant({
  ForwardFailed: IDL.Null,
  NotAllowed: IDL.Null,
  KeyBudgetExhausted: IDL.Null,
  UnknownGame: IDL.Null,
  RateLimited: IDL.Null,
  Forwarded: IDL.Vec(IDL.Nat8),
  LowBudget: IDL.Null,
});

type RelayRequest =
  | { Ingest: string }
  | { Game: { arg: Uint8Array; call: { RequestSignature: null } | { PushRoot: null }; game: Principal } };

export type SubmitOutcome =
  | { tag: "Forwarded"; reply: Uint8Array }
  | { tag: "ForwardFailed" | "NotAllowed" | "KeyBudgetExhausted" | "UnknownGame" | "RateLimited" | "LowBudget" };

interface Relay {
  submit: (req: RelayRequest) => Promise<Record<string, unknown>>;
  get_index: () => Promise<Principal>;
}

const relayIdl: IDL.InterfaceFactory = () =>
  IDL.Service({
    submit: IDL.Func([Request], [SubmitResult], []),
    get_index: IDL.Func([], [IDL.Principal], ["query"]),
  });

let actor: ActorSubclass<Relay> | null = null;

function identity(): Identity {
  return Ed25519KeyIdentity.fromJSON(RELAY_KEY);
}

async function relay(): Promise<ActorSubclass<Relay> | null> {
  if (!isRelayConfigured()) return null;
  if (!actor) {
    const agent = await HttpAgent.create({ host: IC_HOST, identity: identity() });
    if (/localhost|127\.0\.0\.1/.test(IC_HOST)) await agent.fetchRootKey();
    actor = Actor.createActor<Relay>(relayIdl, { agent, canisterId: RELAY_PRINCIPAL });
  }
  return actor;
}

function outcome(r: Record<string, unknown>): SubmitOutcome {
  const tag = Object.keys(r)[0];
  if (tag === "Forwarded") return { tag: "Forwarded", reply: new Uint8Array(r.Forwarded as Uint8Array) };
  return { tag: (tag ?? "ForwardFailed") as Exclude<SubmitOutcome["tag"], "Forwarded"> };
}

/** Pay the index to fold one Solana signature. Dedup is the index's job. */
export async function submitIngest(signature: string): Promise<SubmitOutcome | null> {
  const r = await relay();
  if (!r) return null;
  return outcome(await r.submit({ Ingest: signature }));
}

/**
 * Pay a game for one of its two paid pulls. `arg` is the pre-encoded Candid
 * argument — the relay forwards it verbatim and inspects nothing, so encoding
 * it is the caller's job and mis-encoding it is a `ForwardFailed`, not a hint.
 */
export async function submitGameCall(
  game: string,
  call: "RequestSignature" | "PushRoot",
  arg: Uint8Array
): Promise<SubmitOutcome | null> {
  const r = await relay();
  if (!r) return null;
  return outcome(
    await r.submit({
      Game: {
        arg,
        call: call === "PushRoot" ? { PushRoot: null } : { RequestSignature: null },
        game: Principal.fromText(game),
      },
    })
  );
}

/** `request_signature(chain, scope)` — two text arguments, in that order. */
export function encodeRequestSignature(chain: string, scope: string): Uint8Array {
  return new Uint8Array(IDL.encode([IDL.Text, IDL.Text], [chain, scope]));
}

/** `push_root(cert)` — the index's certificate, raw. */
export function encodePushRoot(cert: Uint8Array): Uint8Array {
  return new Uint8Array(IDL.encode([IDL.Vec(IDL.Nat8)], [cert]));
}

/**
 * Decode a `Forwarded` reply as a game's flat result variant. The relay hands
 * back the downstream answer byte for byte, so this is the same decode the
 * browser would do — only the call itself had to happen here.
 */
export function decodeGameReply(reply: Uint8Array, type: IDL.Type): Record<string, unknown> {
  const [value] = IDL.decode([type], reply);
  return value as unknown as Record<string, unknown>;
}

/** The index's `IngestResult`, for decoding a forwarded `Ingest` reply. */
export const IngestResult = IDL.Variant({
  LowBalance: IDL.Null,
  Applied: IDL.Record({ settlements: IDL.Nat64, anomalies: IDL.Nat64, births: IDL.Nat64 }),
  Underpaid: IDL.Null,
  Duplicate: IDL.Null,
  NotFound: IDL.Null,
  UnknownBirth: IDL.Null,
  AfterCutover: IDL.Null,
});
