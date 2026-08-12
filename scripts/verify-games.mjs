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
import { pathToFileURL } from "node:url";

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

// ---- 3b. the roulette: vectors executed, not read ----
//
// Every other check in this file compares our belief against a canister's pinned
// literal. The roulette has no canister and no signed verdict — its trust model
// IS that independent implementations reach the same winner — so a structural
// comparison would miss exactly the failure that matters. This section therefore
// RUNS `lib/chain/roulette.ts` against the vectors the logic crate pins.
//
// That is possible only because the module was written free of imports (no `@/`
// aliases, no web3.js, no Buffer): bare Node can load it. Keep it that way, or
// this check quietly degrades into a skip.
//
// Node prints MODULE_TYPELESS_PACKAGE_JSON on that import and it is expected:
// this package has no `"type": "module"`, so a `.ts` file is re-parsed as ESM
// after a first attempt as CommonJS. Cosmetic, and cheaper than either flipping
// the package type under Next or dropping the check.
const rlVectors = read("crown-games/roulette/logic/tests/vectors.rs");
const rlLib = read("crown-games/roulette/logic/src/lib.rs");
const rlMemo = read("crown-games/roulette/logic/src/memo.rs");
const dsLib = read("crown-games/direct-settlement/logic/src/lib.rs");

// Rust constants, read out of the crate. Every pattern anchors on `const <NAME>`
// rather than on the name alone: without the anchor `MIN_GROSS` also matches
// inside `INDEX_MIN_GROSS`, and the floor check silently compares the wrong two
// numbers — which is exactly what it did on the first run here.
const rustStr = (src, name) =>
  src.match(new RegExp(`const ${name}: &str = "([\\s\\S]*?)";`))?.[1]?.replace(/\\\s*\n\s*/g, "") ?? null;
const rustBytes = (src, name) => src.match(new RegExp(`const ${name}: &\\[u8\\] = b"([^"]*)"`))?.[1] ?? null;
const rustNum = (src, name) =>
  src.match(new RegExp(`const ${name}: u(?:8|16|32|64|128|size) = ([0-9_]+)`))?.[1]?.replace(/_/g, "") ?? null;

if (!rlVectors || !rlLib || !rlMemo || !dsLib) {
  skip("roulette derivations vs pinned vectors", "sibling clone not present");
} else {
  let RL = null;
  try {
    RL = await import(pathToFileURL(path.join(APP, "lib/chain/roulette.ts")).href);
  } catch (e) {
    skip("roulette derivations vs pinned vectors", `this Node cannot import TypeScript (${e.code ?? e.message})`);
  }

  if (RL) {
    // -- constants, both sides --
    check("roulette round domain matches", RL.RL_DOMAIN_ROUND === rustBytes(rlLib, "DOMAIN_ROUND"), RL.RL_DOMAIN_ROUND);
    check("roulette entry domain matches", RL.RL_DOMAIN_ENTRY === rustBytes(rlLib, "DOMAIN_ENTRY"), RL.RL_DOMAIN_ENTRY);
    check("roulette spin domain matches", RL.RL_DOMAIN_SPIN === rustBytes(rlLib, "DOMAIN_SPIN"), RL.RL_DOMAIN_SPIN);
    check("roulette memo prefix matches", RL.RL_MEMO_PREFIX === rustStr(rlMemo, "MEMO_PREFIX"), RL.RL_MEMO_PREFIX);
    check("roulette memo length matches", String(RL.RL_MEMO_LEN) === rustNum(rlMemo, "MEMO_LEN"), String(RL.RL_MEMO_LEN));
    check("roulette title cap matches", String(RL.RL_MAX_TITLE_BYTES) === rustNum(rlLib, "MAX_TITLE_BYTES"), String(RL.RL_MAX_TITLE_BYTES));
    check("roulette topic cap matches", String(RL.RL_MAX_TOPIC_BYTES) === rustNum(rlLib, "MAX_TOPIC_BYTES"), String(RL.RL_MAX_TOPIC_BYTES));

    // -- the floor is a derivation, and it must be the same derivation --
    // The crate's number is the mainnet one; ours is per-cluster. So what is
    // compared is the RULE (donation floor → what the splitter moves), not the
    // literal, which would only ever match on one cluster.
    const dsFloor = BigInt(rustNum(dsLib, "MIN_GROSS"));
    const dsFee = Number(rustNum(dsLib, "FEE_BPS"));
    check(
      "roulette floor is derived the way the crate derives it",
      RL.entryFloorFromDonation(dsFloor, dsFee) === BigInt(rustNum(rlLib, "MIN_GROSS")),
      String(RL.entryFloorFromDonation(dsFloor, dsFee))
    );
    const appDsFloor = configSrc.match(/DS_MIN_GROSS = ([0-9_]+)/)?.[1]?.replace(/_/g, "");
    const appDsFee = configSrc.match(/DS_FEE_BPS = (\d+)/)?.[1];
    if (appDsFloor && appDsFee) {
      console.log(
        `  wheel floor on "${CHAIN_ID}" = ${RL.entryFloorFromDonation(BigInt(appDsFloor), Number(appDsFee))} ` +
          `(from a donation floor of ${appDsFloor})`
      );
    }

    // -- the vectors themselves --
    // Inputs are restated here; ANSWERS come from the crate. A drift in an input
    // cannot pass silently, because then the pinned answers stop matching.
    const vec = (name) => rustStr(rlVectors, name);
    const bytes = (hex) => Uint8Array.from(Buffer.from(hex, "hex"));
    const chain = createHash("sha256").update("crown-chain:v1:devnet").digest("hex");
    check("roulette vector chain key is the index derivation", chain === vec("CHAIN_DEVNET"), chain);

    const announcement = {
      chain: bytes(chain),
      recipient: new Uint8Array(32).fill(0x11),
      nonce: 1n,
      openSlot: 1000n,
      closeSlot: 1100n,
      minGross: BigInt(rustNum(rlLib, "MIN_GROSS")),
      playMinutes: 60n,
      stageSlots: 0n,
      topic: new TextEncoder().encode("game"),
    };

    const encoded = RL.rlHex(RL.encodeAnnouncement(announcement));
    check("roulette announcement encodes to the pinned bytes", encoded === vec("ENCODED"), encoded);

    const roundId = await RL.deriveRoundId(announcement);
    check("roulette round_id matches the pinned digest", RL.rlHex(roundId) === vec("ROUND_ID"), RL.rlHex(roundId));
    // The validator takes the cluster's floor rather than a constant, so both
    // directions are checked: the vector's round is ours at the mainnet floor,
    // and a round a hair under it is not.
    const rlFloor = BigInt(rustNum(rlLib, "MIN_GROSS"));
    check("roulette announcement passes its own validator", RL.validateAnnouncement(announcement, rlFloor) === null);
    check(
      "roulette validator refuses a floor under the platform's",
      RL.validateAnnouncement({ ...announcement, minGross: rlFloor - 1n }, rlFloor) === "FloorBelowPlatform"
    );

    const titles = { "Warcraft III": "KEY_WARCRAFT", "Elden Ring": "KEY_ELDEN", "Dota 2": "KEY_DOTA" };
    for (const [title, constName] of Object.entries(titles)) {
      const key = await RL.deriveEntryKey(roundId, new TextEncoder().encode(title));
      check(`roulette entry key for "${title}"`, RL.rlHex(key) === vec(constName), RL.rlHex(key));
    }

    const memo = await RL.memoForTitle(roundId, new TextEncoder().encode("Warcraft III"));
    check("roulette memo matches the pinned string", memo === vec("MEMO_WARCRAFT"), String(memo));
    check("roulette memo round-trips through its own parser", RL.rlHex(RL.parseMemo(memo)?.entryKey ?? new Uint8Array()) === vec("KEY_WARCRAFT"));

    // The wheel: canonical order is by key, so the stakes go in unsorted on
    // purpose — the order below is the order they were staked, not the answer.
    const stakes = [];
    for (const [title, gross] of [["Warcraft III", 2_000_000n], ["Elden Ring", 5_000_000n], ["Dota 2", 1_000_000n]]) {
      stakes.push({ key: await RL.deriveEntryKey(roundId, new TextEncoder().encode(title)), gross });
    }
    const wheel = RL.tallyWheel(stakes, announcement.minGross);
    const order = wheel.slices.map((s) => RL.rlHex(s.key)).join(",");
    check(
      "roulette wheel is in canonical key order",
      order === [vec("KEY_DOTA"), vec("KEY_ELDEN"), vec("KEY_WARCRAFT")].join(","),
      order
    );
    check("roulette wheel total", wheel.total === 8_000_000n, String(wheel.total));

    // Elimination: the same three slices, one knock-out per stage, each with its
    // own beacon. Pinned because the ORDER things go out in is now part of the law
    // two implementations must agree on — and because the weights behind it are
    // integer arithmetic (`isqrt`) that a floating-point shortcut would silently
    // diverge on.
    const elimStakes = stakes.slice();
    const gone = [];
    let alive = RL.tallyWheel(elimStakes, announcement.minGross);
    for (let stage = 0; stage < 8; stage++) {
      const out = await RL.knockOut(roundId, new Uint8Array(32).fill(0x33 + stage), stage, alive);
      if (!out) break;
      gone.push(RL.rlHex(out));
      alive = RL.tallyWheel(
        elimStakes.filter((s) => !gone.includes(RL.rlHex(s.key))),
        announcement.minGross
      );
    }
    check(
      "roulette elimination knocks out in the crate's order",
      gone.join(",") === [vec("KEY_DOTA"), vec("KEY_WARCRAFT")].join(","),
      gone.join(",")
    );
    check(
      "…and leaves the crate's survivor standing",
      alive.slices.length === 1 && RL.rlHex(alive.slices[0].key) === vec("KEY_ELDEN"),
      alive.slices.map((s) => RL.rlHex(s.key)).join(",")
    );
    // The property the format is sold on, checked as arithmetic rather than as a
    // story: the smaller pool is likelier to be knocked out, and a hair of lead
    // does not buy immunity.
    const w2 = RL.eliminationWeights([
      { key: new Uint8Array(32), weight: 100_000_000n },
      { key: new Uint8Array(32), weight: 101_000_000n },
    ]);
    const share = Number((w2[0] * 10_000n) / (w2[0] + w2[1])) / 100;
    check("roulette: a 1% lead buys ~1% of safety, not immunity", share > 49 && share < 51, `${share}%`);

    const verdict = await RL.spinWheel(roundId, new Uint8Array(32).fill(0x22), wheel);
    // The crate names the winner by alias (`WINNER: &str = KEY_ELDEN`), so the
    // alias is checked too — otherwise this would compare against a slice we
    // chose rather than the one it pinned.
    check(
      "roulette crate pins Elden Ring as the winner of this vector",
      /const WINNER: &str = KEY_ELDEN;/.test(rlVectors)
    );
    check(
      "roulette spin lands on the pinned slice",
      verdict.kind === "winner" && RL.rlHex(verdict.key) === vec("KEY_ELDEN") && verdict.weight === 5_000_000n,
      verdict.kind === "winner" ? RL.rlHex(verdict.key) : "void"
    );
  }
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
