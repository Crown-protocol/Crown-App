// Verifies what this app SAYS to the game canisters against what they accept:
// the scope-id preimages, the exact bytes of every signed message, and the wire
// framing that carries them. Run: node scripts/verify-games.mjs
//
// These are the checks with no second chance. A wrong salt or account order dies
// loudly on chain; a wrong signed message dies at an anonymous boundary that
// answers `Malformed` and says nothing else, after the donor's money is already
// in escrow. So the comparison here is against the canisters' OWN pinned test
// vectors — the byte-exact strings their `protocol.rs` asserts on — rather than
// against a copy of our belief.
//
// SKIPPED, not failed, without the sibling clones: this repo is cloned alone
// often enough that a hard failure would only teach people to ignore the script.
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const APP = path.resolve(import.meta.dirname, "..");
const WORKSPACE = path.resolve(APP, "..");

let failed = 0;
let skipped = 0;
const check = (name, ok, got = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : `\n    got:      ${got}`}`);
  if (!ok) failed++;
};
const skip = (name, why) => {
  console.log(`· ${name} — SKIPPED (${why})`);
  skipped++;
};
const read = (rel) => {
  const p = path.join(WORKSPACE, rel);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
};

// ---- what this app builds, read from the files that build it ----
const gamesSrc = readFileSync(path.join(APP, "lib/chain/games.ts"), "utf8");
const wireSrc = readFileSync(path.join(APP, "lib/chain/wire.ts"), "utf8");
const configSrc = readFileSync(path.join(APP, "lib/chain/config.ts"), "utf8");
const CHAIN_ID = configSrc.match(/NEXT_PUBLIC_CHAIN_ID \|\| "([^"]+)"/)?.[1];

// Rebuild the messages the way games.ts does — same field order, same joiner,
// and crucially NO trailing newline. If the two ever diverge, the literals below
// stop matching and this reddens.
const message = (domain, entries) => `${domain}\n${entries.map(([k, v]) => `${k}: ${v}`).join("\n")}`;

const TASKS_DOMAIN = gamesSrc.match(/TASKS_DOMAIN = "([^"]+)"/)?.[1];
const FUNDING_DOMAIN = gamesSrc.match(/FUNDING_DOMAIN = "([^"]+)"/)?.[1];

// ---- 1. domains, as the canisters froze them ----
const tasksProto = read("crown-games/conditional-tasks/canister/src/protocol.rs");
const fundingProto = read("crown-games/conditional-funding/canister/src/protocol.rs");

if (!tasksProto || !fundingProto) {
  skip("game domains and message vectors", "sibling clones not present");
} else {
  check(
    "tasks domain matches the canister's DOMAIN",
    TASKS_DOMAIN === tasksProto.match(/DOMAIN: &str = "([^"]+)"/)?.[1],
    String(TASKS_DOMAIN)
  );
  check(
    "funding domain matches the canister's DOMAIN",
    FUNDING_DOMAIN === fundingProto.match(/DOMAIN: &str = "([^"]+)"/)?.[1],
    String(FUNDING_DOMAIN)
  );

  // ---- 2. byte-exact messages, against the canisters' own pinned literals ----
  // The literals live in `messages_are_byte_exact`; they use chain "devnet",
  // canister "aaaaa-aa" and toy ids, so the same substitutions rebuild them here.
  const literals = [...`${tasksProto}\n${fundingProto}`.matchAll(/"(crown:conditional-[a-z]+:v1\\n[^"]*)"/g)].map((m) =>
    m[1].replace(/\\n/g, "\n")
  );
  const built = {
    "tasks/register": message(TASKS_DOMAIN, [
      ["action", "register"], ["chain", "devnet"], ["canister", "aaaaa-aa"],
      ["task", "T"], ["text", "ab12"], ["duration", "3600"],
    ]),
    "tasks/accept": message(TASKS_DOMAIN, [
      ["action", "accept"], ["chain", "devnet"], ["canister", "aaaaa-aa"], ["task", "T"],
    ]),
    "tasks/vote": message(TASKS_DOMAIN, [
      ["action", "vote"], ["chain", "devnet"], ["canister", "aaaaa-aa"], ["task", "T"], ["choice", "done"],
    ]),
    "funding/create": message(FUNDING_DOMAIN, [
      ["action", "create"], ["chain", "devnet"], ["canister", "aaaaa-aa"],
      ["collection", "ab12"], ["goal", "5000000"], ["duration", "600"],
    ]),
    "funding/vote": message(FUNDING_DOMAIN, [
      ["action", "vote"], ["chain", "devnet"], ["canister", "aaaaa-aa"], ["collection", "ab12"], ["choice", "done"],
    ]),
  };
  for (const [name, text] of Object.entries(built)) {
    check(`${name} message is byte-exact`, literals.includes(text), JSON.stringify(text));
  }
  if (!literals.length) skip("message vectors", "the canisters pin no literal any more");

  // ---- 3. scope-id preimages ----
  // Same approach as the salt in verify-chain: compare the ORDER OF FIELDS the
  // canister hashes, since neither side pins a digest.
  const preimage = (src, fnName) => {
    const body = src.match(new RegExp(`pub fn ${fnName}\\([\\s\\S]*?\\n}`))?.[0] ?? "";
    return [...body.matchAll(/h\.update\((.*)\);/g)].map((m) => m[1].trim());
  };
  check(
    "task_id preimage order",
    JSON.stringify(preimage(tasksProto, "task_id")) ===
      JSON.stringify([
        "TASK_ID_PREFIX",
        "[canister.len() as u8]",
        "canister",
        "donor",
        "recipient",
        "gross.to_le_bytes()",
        "deadline.to_le_bytes()",
        "fee_bps.to_le_bytes()",
        "fee_wallet",
        "nonce.to_le_bytes()",
        "duration.to_le_bytes()",
        "voting_period.to_le_bytes()",
      ]),
    preimage(tasksProto, "task_id").join(" ‖ ")
  );
  check(
    "collection_id preimage order",
    JSON.stringify(preimage(fundingProto, "collection_id")) ===
      JSON.stringify([
        "COLLECTION_ID_PREFIX",
        "[canister.len() as u8]",
        "canister",
        "recipient",
        "recipient_nonce.to_le_bytes()",
        "duration.to_le_bytes()",
        "voting_period.to_le_bytes()",
        "approval_threshold.to_le_bytes()",
        "quorum_weight.to_le_bytes()",
      ]),
    preimage(fundingProto, "collection_id").join(" ‖ ")
  );

  const appPrefixes = [...gamesSrc.matchAll(/Buffer\.from\("(crown:conditional-[a-z]+)", "utf8"\)/g)].map((m) => m[1]);
  check(
    "scope-id prefixes match the canisters'",
    appPrefixes.includes(tasksProto.match(/TASK_ID_PREFIX: &\[u8\] = b"([^"]+)"/)?.[1]) &&
      appPrefixes.includes(fundingProto.match(/COLLECTION_ID_PREFIX: &\[u8\] = b"([^"]+)"/)?.[1]),
    appPrefixes.join(", ")
  );
}

// ---- 4. the wire framing ----
const requestSrc = read("crown-games/common/src/request.rs");
if (!requestSrc) {
  skip("wire framing vs crown-games-common", "sibling clone not present");
} else {
  const sep = requestSrc.match(/const SEP: &str = "([^"]+)"/)?.[1];
  const appSep = wireSrc.match(/const SEP = "([^"]+)"/)?.[1];
  check("request separator matches", sep === appSep, JSON.stringify(appSep));
  check(
    "auth fields are pubkey + signature",
    /get\("pubkey"\)/.test(requestSrc) && /get\("signature"\)/.test(requestSrc) && /\["pubkey"/.test(wireSrc) && /\["signature"/.test(wireSrc)
  );
}

const fieldSrc = read("crown-games/common/src/field.rs");
if (!fieldSrc) {
  skip("argument cap and chain key vs crown-games-common", "sibling clone not present");
} else {
  const cap = fieldSrc.match(/MAX_ARG_BYTES: usize = (\d+) \* 1024/)?.[1];
  const appCap = wireSrc.match(/MAX_ARG_BYTES = (\d+) \* 1024/)?.[1];
  check("argument cap matches", cap === appCap, String(appCap));

  // The book's chain key — one derivation shared by the index, the games and us.
  const domain = fieldSrc.match(/h\.update\(b"([^"]+)"\);/)?.[1];
  const icpSrc = readFileSync(path.join(APP, "lib/chain/icp.ts"), "utf8");
  const appDomain = icpSrc.match(/Buffer\.from\("([^"]+)", "utf8"\)/)?.[1];
  check("chain-key domain matches", domain === appDomain, String(appDomain));
  if (domain && CHAIN_ID) {
    const key = createHash("sha256").update(`${domain}${CHAIN_ID}`).digest("hex");
    console.log(`  chain key for "${CHAIN_ID}" = ${key.slice(0, 16)}…`);
  }
}

// ---- 5. the fields each registration must carry ----
// A missing extra is a `Malformed` with no explanation, so the set is checked
// rather than remembered.
const tasksLib = read("crown-games/conditional-tasks/canister/src/lib.rs");
const fundingLib = read("crown-games/conditional-funding/canister/src/lib.rs");
const flowsSrc = readFileSync(path.join(APP, "lib/chain/gameFlows.ts"), "utf8");
const collectionsSrc = readFileSync(path.join(APP, "lib/server/collections.ts"), "utf8");

const extrasOf = (src, fnName) => {
  const body = src?.match(new RegExp(`fn ${fnName}\\([\\s\\S]*?\\n}`))?.[0] ?? "";
  return [...body.matchAll(/req\.extra\("([a-z_]+)"\)/g)].map((m) => m[1]).sort();
};

if (!tasksLib || !fundingLib) {
  skip("registration extras", "sibling clones not present");
} else {
  const taskExtras = [...new Set(extrasOf(tasksLib, "admit_register"))];
  const sentByApp = taskExtras.every((f) => new RegExp(`\\["${f}"`).test(flowsSrc));
  check(`task registration sends every extra it must (${taskExtras.join(", ")})`, sentByApp);

  const colExtras = [...new Set(extrasOf(fundingLib, "admit_create_collection"))];
  const sentByServer = colExtras.every((f) => new RegExp(`\\["${f}"`).test(collectionsSrc));
  check(`collection creation sends every extra it must (${colExtras.join(", ")})`, sentByServer);

  const voteExtras = [...new Set(extrasOf(tasksLib, "voter_weight"))];
  check(
    `a vote sends its weight proof (${voteExtras.join(", ")})`,
    voteExtras.every((f) => new RegExp(`\\["${f}"`).test(flowsSrc))
  );
}

if (skipped) console.log(`\n${skipped} check(s) skipped — clone the perimeter repos next to this one to run them.`);
process.exit(failed ? 1 : 0);
