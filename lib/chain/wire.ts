import bs58 from "bs58";

// ──────────────────────────────────────────────────────────────────
// The wire framing every Crown game update takes (`crown-games-common::request`,
// harness §7). One `text` argument, two sections:
//
//   <domain>                     ← first line, checked before anything else
//   action: <action>             ← the signed message: the game's frozen format
//   chain: devnet
//   canister: <principal>
//   …game fields…
//   ---
//   pubkey: <bs58(32)>           ← auth + unsigned extras
//   signature: <bs58(64)>
//   …extras (birth-proof fields, witnesses)…
//
// Authorization is the WALLET signature over the signed section — not the IC
// caller, which is anonymous. Extras are never trusted for authorization: the
// canister cross-checks them against the birth proof.
//
// Two details are load-bearing and both were wrong in the previous client:
//   · the sections are joined by exactly "\n---\n" and the message does NOT end
//     with a newline — a trailing "\n" changes the signed bytes and the
//     signature stops verifying, with nothing said about why;
//   · the first line is the game's versioned domain and it IS checked, so a
//     signature over any other text authorizes nothing (that check is what makes
//     a phished "login challenge" with the right lines in it useless).
// ──────────────────────────────────────────────────────────────────

const SEP = "\n---\n";

/** Join `key: value` lines the way every parser here reads them. */
export function fields(entries: Array<[string, string]>): string {
  return entries.map(([k, v]) => `${k}: ${v}`).join("\n");
}

/**
 * A canonical signed message: the domain line, then the fields in the game's
 * frozen order. Order matters — the canister rebuilds this string byte for byte
 * to verify the signature.
 */
export function message(domain: string, entries: Array<[string, string]>): string {
  return `${domain}\n${fields(entries)}`;
}

/**
 * Frame a signed message with its wallet auth and any unsigned extras.
 * `signature` is over the UTF-8 bytes of `signedMessage`, nothing more.
 */
export function request(args: {
  signedMessage: string;
  pubkey: Uint8Array;
  signature: Uint8Array;
  extras?: Array<[string, string]>;
}): string {
  if (args.pubkey.length !== 32) throw new Error("Wallet pubkey must be 32 bytes.");
  if (args.signature.length !== 64) throw new Error("Wallet signature must be 64 bytes.");
  const auth: Array<[string, string]> = [
    ["pubkey", bs58.encode(args.pubkey)],
    ["signature", bs58.encode(args.signature)],
    ...(args.extras ?? []),
  ];
  return `${args.signedMessage}${SEP}${fields(auth)}`;
}

/**
 * Largest argument any game accepts, cut at the boundary before a single parse
 * (`crown-games-common::field::MAX_ARG_BYTES`). Checked client-side too: past it
 * the call is dropped with no reason given, which reads as an unexplained
 * refusal. A vote or a registration is far below it; only a witness at book
 * capacity approaches it.
 */
export const MAX_ARG_BYTES = 8 * 1024;

export function withinArgCap(text: string): boolean {
  return new TextEncoder().encode(text).length <= MAX_ARG_BYTES;
}
