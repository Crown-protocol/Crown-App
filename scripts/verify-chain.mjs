// Verifies this app's chain arithmetic against the perimeter it talks to, in
// three layers: the constants (do they still equal the perimeter's own config
// files?), the derivations (discriminators, salt, PDA, verdict message), and the
// live devnet deployment (are the programs there, and does a real instruction
// decode?). Run: node scripts/verify-chain.mjs
//
// Fails loudly (exit 1) on ANY mismatch — this is money code. The perimeter
// checks are SKIPPED, not failed, when the sibling clones are absent: this repo
// is cloned on its own often enough that a hard failure would only teach people
// to ignore the script.
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { PublicKey } from "@solana/web3.js";

const APP = path.resolve(import.meta.dirname, "..");
const WORKSPACE = path.resolve(APP, "..");
const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC || "https://api.devnet.solana.com";

let failed = 0;
let skipped = 0;
const check = (name, ok, got = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : ` — got ${got}`}`);
  if (!ok) failed++;
};
const skip = (name, why) => {
  console.log(`· ${name} — SKIPPED (${why})`);
  skipped++;
};

const sha8 = (s) => createHash("sha256").update(s).digest().subarray(0, 8).toString("hex");
const u64le = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
const i64le = (v) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(v)); return b; };
const u16le = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };

// ── 0. What this app believes, read from the file that holds it ───────────
// Parsed rather than imported: the config is TypeScript and this script is the
// one thing that must keep working with no build step.
const configSrc = readFileSync(path.join(APP, "lib/chain/config.ts"), "utf8");
const constOf = (name) => {
  const m = configSrc.match(new RegExp(`${name}[^\\n]*\\|\\|\\s*"([^"]+)"`)) ||
    configSrc.match(new RegExp(`export const ${name} = ([0-9_]+)`));
  return m ? m[1].replace(/_/g, "") : null;
};
const APP_CHAIN_ID = constOf("CHAIN_ID");
const APP_SPLITTER = constOf("NEXT_PUBLIC_SPLITTER");
const APP_USDC = constOf("NEXT_PUBLIC_USDC_MINT");
const APP_FACTORY = constOf("NEXT_PUBLIC_FACTORY_TWO_OUTCOME");
const APP_FEE_WALLET = constOf("NEXT_PUBLIC_FEE_WALLET");
const APP_FEE_BPS = constOf("FEE_BPS");
const APP_MIN_GROSS = constOf("MIN_GROSS_TASK");
const APP_VOTING_PERIOD = constOf("VOTING_PERIOD");
const APP_VERDICT_DOMAIN = `crown:two-outcome:${APP_CHAIN_ID}`;

check("config.ts parsed", !!(APP_SPLITTER && APP_USDC && APP_FACTORY && APP_FEE_WALLET));

// ── 1. Drift against the perimeter's own profiles ─────────────────────────
// The perimeter is the source of truth for every one of these; this app holds a
// copy, and a copy nobody compares is a copy that has already drifted.
const toml = (rel) => {
  const p = path.join(WORKSPACE, rel);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
};
const tomlValue = (src, key) => {
  const m = src.match(new RegExp(`^\\s*${key}\\s*=\\s*"?([^"#\\n]+)"?`, "m"));
  return m ? m[1].trim().replace(/_/g, "") : null;
};

const indexerCfg = toml("crown-indexer/config/testnet.toml");
if (!indexerCfg) {
  skip("perimeter: crown-indexer/config/testnet.toml", "sibling clone not present");
} else {
  check(`chain id = ${tomlValue(indexerCfg, "id")}`, APP_CHAIN_ID === tomlValue(indexerCfg, "id"), APP_CHAIN_ID);
  check("splitter matches the index's pinned root", APP_SPLITTER === tomlValue(indexerCfg, "splitter"), APP_SPLITTER);
  check("USDC mint matches the index's profile", APP_USDC === tomlValue(indexerCfg, "usdc"), APP_USDC);
  const factories = indexerCfg.match(/factories\s*=\s*\[([^\]]+)\]/)?.[1] ?? "";
  check("two-outcome factory is a recognized factory", factories.includes(APP_FACTORY), APP_FACTORY);
}

const tasksCfg = toml("crown-games/conditional-tasks/config/testnet.toml");
if (!tasksCfg) {
  skip("perimeter: conditional-tasks/config/testnet.toml", "sibling clone not present");
} else {
  check("fee wallet matches the game's config", APP_FEE_WALLET === tomlValue(tasksCfg, "fee_wallet"), APP_FEE_WALLET);
  check("fee_bps matches the game's config", APP_FEE_BPS === tomlValue(tasksCfg, "fee_bps"), APP_FEE_BPS);
  check("task floor matches the game's min_gross", APP_MIN_GROSS === tomlValue(tasksCfg, "min_gross"), APP_MIN_GROSS);
  check("voting period matches the game's config", APP_VOTING_PERIOD === tomlValue(tasksCfg, "voting_period"), APP_VOTING_PERIOD);
  check("factory matches the game's chain profile", APP_FACTORY === tomlValue(tasksCfg, "factory"), APP_FACTORY);
  check("verdict domain matches the game's baked domain", APP_VERDICT_DOMAIN === tomlValue(tasksCfg, "domain"), APP_VERDICT_DOMAIN);
}

// direct-settlement ships no config — its spec table IS the source, and this app
// is the client that spec says owns the profile. So the floor is compared against
// that table: a number the UI now advertises to every donor.
const dsSpec = (() => {
  const p = path.join(WORKSPACE, "crown-games/direct-settlement/docs/spec.md");
  return existsSync(p) ? readFileSync(p, "utf8") : null;
})();
if (!dsSpec) {
  skip("perimeter: direct-settlement floors", "sibling clone not present");
} else {
  const row = dsSpec.match(/`MIN_GROSS`[^\n]*devnet `([0-9_]+)`/);
  const feeRow = dsSpec.match(/`FEE_BPS`[^\n]*`(\d+)`/);
  const appDsMin = constOf("DS_MIN_GROSS");
  const appDsFee = constOf("DS_FEE_BPS");
  check("direct-settlement floor matches its spec", row && appDsMin === row[1].replace(/_/g, ""), String(appDsMin));
  check("direct-settlement fee matches its spec", feeRow && appDsFee === feeRow[1], String(appDsFee));
  const indexFloor = dsSpec.match(/`INDEX_MIN_GROSS`[^\n]*`([0-9_]+)`/);
  check(
    "book dust floor matches its spec",
    indexFloor && constOf("INDEX_MIN_GROSS") === indexFloor[1].replace(/_/g, ""),
    String(constOf("INDEX_MIN_GROSS"))
  );
}

const factoryDeploy = toml("crown-factory/deploy/testnet.toml");
if (!factoryDeploy) {
  skip("perimeter: crown-factory/deploy/testnet.toml", "sibling clone not present");
} else {
  check("factory's splitter is the one we donate to", APP_SPLITTER === tomlValue(factoryDeploy, "splitter"), APP_SPLITTER);
  check("factory's verdict domain", APP_VERDICT_DOMAIN === tomlValue(factoryDeploy, "two_outcome"), APP_VERDICT_DOMAIN);
}

const twoOutcomeSrc = existsSync(path.join(WORKSPACE, "crown-factory/shapes/two-outcome/solana/src/lib.rs"))
  ? readFileSync(path.join(WORKSPACE, "crown-factory/shapes/two-outcome/solana/src/lib.rs"), "utf8")
  : null;
if (!twoOutcomeSrc) {
  skip("perimeter: two-outcome declare_id", "sibling clone not present");
} else {
  const declared = twoOutcomeSrc.match(/declare_id!\("([^"]+)"\)/)?.[1];
  check("factory id matches the program's own declare_id", APP_FACTORY === declared, APP_FACTORY);
}

// ── 2. Derivations ────────────────────────────────────────────────────────
check("donate discriminator", sha8("global:donate") === "79badad34946c4b4", sha8("global:donate"));
check("create_escrow discriminator", sha8("global:create_escrow") === "fdd7a574246c4450", sha8("global:create_escrow"));
check("claim discriminator", sha8("global:claim") === "3ec6d6c1d59f6cd2", sha8("global:claim"));
check("refund discriminator", sha8("global:refund") === "0260b7fb3fd02e2e", sha8("global:refund"));
check("Escrow account discriminator", sha8("account:Escrow") === "1fd57bbbba16da9b", sha8("account:Escrow"));

// crown-salt, two-outcome: donor ‖ recipient ‖ gross ‖ deadline ‖ resolver ‖
// fee_bps ‖ fee_wallet ‖ nonce. Checked against the perimeter's own crate rather
// than a number copied here — a vector nobody generates is a vector that agrees
// with whatever this file already says.
const saltOf = (donor, recipient, gross, deadline, resolver, feeBps, feeWallet, nonce) =>
  createHash("sha256")
    .update(Buffer.concat([donor, recipient, u64le(gross), i64le(deadline), resolver, u16le(feeBps), feeWallet, u64le(nonce)]))
    .digest();
const vectorSalt = saltOf(
  Buffer.alloc(32, 0x11), Buffer.alloc(32, 0x22), 1_000_000, 1_900_000_000,
  Buffer.alloc(32, 0x33), 500, Buffer.alloc(32, 0x44), 7
);
// crown-salt pins no hex vector — its own test checks the formula against the
// formula — so there is nothing to compare a digest to. What CAN be compared is
// the preimage itself: the crate hashes eight fields in one order with fixed
// widths, and that order is exactly what this app has to copy. Reading it out of
// the crate turns "we believe we match" into a check that reddens the day the
// crate changes.
const saltSrc = existsSync(path.join(WORKSPACE, "crown-factory/salt/src/two_outcome.rs"))
  ? readFileSync(path.join(WORKSPACE, "crown-factory/salt/src/two_outcome.rs"), "utf8")
  : null;
if (!saltSrc) {
  skip("salt preimage vs crown-salt", "sibling clone not present");
} else {
  const updates = [...saltSrc.matchAll(/h\.update\((.*)\);/g)].map((m) => m[1].trim());
  const expected = [
    "donor",
    "recipient",
    "gross.to_le_bytes()",
    "deadline.to_le_bytes()",
    "resolver",
    "fee_bps.to_le_bytes()",
    "fee_wallet",
    "nonce.to_le_bytes()",
  ];
  check(
    "salt preimage is donor‖recipient‖gross‖deadline‖resolver‖fee_bps‖fee_wallet‖nonce",
    JSON.stringify(updates) === JSON.stringify(expected),
    updates.join(" ‖ ")
  );
}

const escrowPda = PublicKey.findProgramAddressSync(
  [Buffer.from("escrow"), vectorSalt],
  new PublicKey(APP_FACTORY)
)[0];
check(`escrow PDA derives from the salt (${escrowPda.toBase58().slice(0, 8)}…)`, escrowPda instanceof PublicKey);

// The book's chain key — sha256("crown-chain:v1:" ‖ id), the third of every book
// key. The games derive it identically (`crown-games-common::field::chain_id`).
const chainKey = createHash("sha256").update(`crown-chain:v1:${APP_CHAIN_ID}`).digest();
check(`book chain key derives (${chainKey.toString("hex").slice(0, 12)}…)`, chainKey.length === 32);

// The verdict message: domain ‖ program_id(32) ‖ outcome(1) ‖ fee_bps(2) ‖ fee_wallet(32).
const verdict = Buffer.concat([
  Buffer.from(APP_VERDICT_DOMAIN, "utf8"),
  new PublicKey(APP_FACTORY).toBuffer(),
  Buffer.from([0]),
  u16le(Number(APP_FEE_BPS)),
  new PublicKey(APP_FEE_WALLET).toBuffer(),
]);
check(
  `verdict message is ${APP_VERDICT_DOMAIN.length + 67} bytes`,
  verdict.length === APP_VERDICT_DOMAIN.length + 67,
  String(verdict.length)
);

// …and its layout, read off the program that compares against it. The escrow
// address is deliberately absent (one signature opens a whole scope) and the fee
// pair is what makes that safe — a client that dropped either would produce a
// signature no `claim` accepts, silently.
if (!twoOutcomeSrc) {
  skip("verdict layout vs the factory", "sibling clone not present");
} else {
  const body = twoOutcomeSrc.match(/fn assert_resolver_signed[\s\S]*?\n}/)?.[0] ?? "";
  const parts = [...body.matchAll(/expected\.(?:extend_from_slice|push)\(([^;]+)\);/g)].map((m) =>
    m[1].replace(/\s+/g, "").replace(/^&/, "")
  );
  const expectedParts = [
    "VERDICT_DOMAIN.as_bytes()",
    "crate::ID.as_ref()",
    "outcome",
    "ctx.accounts.escrow.fee_bps.to_le_bytes()",
    "ctx.accounts.escrow.fee_wallet.as_ref()",
  ];
  check(
    "verdict layout is domain‖program‖outcome‖fee_bps‖fee_wallet",
    JSON.stringify(parts) === JSON.stringify(expectedParts),
    parts.join(" ‖ ")
  );
}

// ── 3. Live devnet ────────────────────────────────────────────────────────
async function rpc(method, params) {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return (await r.json()).result;
}

const splitterInfo = await rpc("getAccountInfo", [APP_SPLITTER, { encoding: "base64" }]);
check("splitter deployed & executable on devnet", !!splitterInfo?.value?.executable);
const factInfo = await rpc("getAccountInfo", [APP_FACTORY, { encoding: "base64" }]);
check("two-outcome factory deployed & executable", !!factInfo?.value?.executable);
// ── The bytes on chain are the bytes of the source next door ──────────────
//
// Every other check here compares a NUMBER we copied against the number our
// neighbour keeps. None of them can see the one drift that actually bit: the
// two-outcome program on devnet was deployed ten days before the commit that
// bound `fee_bps`/`fee_wallet` into the verdict message, so the canister signed
// 91 bytes and the program compared them against the 57 it still expected. Every
// claim failed with `VerdictMismatch` — a refusal that names no field — and
// nothing anywhere went red, because the program was deployed, executable, and
// decoded every instruction we build. Only the settlement path knew, and only
// once money was already in escrow.
//
// So this compares the deployed bytecode with a local build of the source. It is
// the honest form of the question "is what runs the thing we wrote".
{
  const local = new URL("../../crown-factory/target/deploy/two_outcome.so", import.meta.url);
  let built = null;
  try {
    built = readFileSync(local);
  } catch {
    /* no sibling clone, or nothing built there yet */
  }
  if (!built) {
    skip("two-outcome on devnet is the build of its source", "crown-factory/target/deploy/two_outcome.so — run `cargo build-sbf` there");
  } else {
    // An upgradeable program's ELF lives in its ProgramData account, past a
    // 45-byte header (tag + slot + optional authority).
    const LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
    const programData = PublicKey.findProgramAddressSync([new PublicKey(APP_FACTORY).toBytes()], LOADER)[0].toBase58();
    const acc = await rpc("getAccountInfo", [programData, { encoding: "base64" }]);
    const raw = acc?.value?.data?.[0] ? Buffer.from(acc.value.data[0], "base64") : null;
    const onChain = raw ? raw.subarray(45, 45 + built.length) : null;
    check(
      "two-outcome on devnet is the build of its source",
      !!onChain && onChain.equals(built),
      onChain ? `deployed bytes differ from crown-factory/target/deploy/two_outcome.so (${onChain.length} vs ${built.length})` : "no program data account"
    );
  }
}

const mintInfo = await rpc("getAccountInfo", [APP_USDC, { encoding: "jsonParsed" }]);
const dec = mintInfo?.value?.data?.parsed?.info?.decimals;
check("USDC mint exists with 6 decimals", dec === 6, String(dec));

// ── 4. Real instructions, simulated ───────────────────────────────────────
// An unsigned, unfunded simulation cannot succeed — that is not what it is for.
// What it proves is that the deployed programs DECODE what we build and accept
// every address we derived: a wrong argument layout dies as
// InstructionDidNotDeserialize, a wrong PDA or ATA as a constraint violation.
//
// What it does NOT prove, and the comment used to imply: `create_escrow` stops
// at Anchor's `init` (the donor has no rent), so the instruction BODY — the
// on-chain re-hash that would answer `SaltMismatch` — never runs. The salt is
// checked instead against the crate's own preimage, above, which is a local
// check that can actually redden.
const { Transaction, TransactionInstruction, SystemProgram } = await import("@solana/web3.js");
const { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction } =
  await import("@solana/spl-token");

const USDC_KEY = new PublicKey(APP_USDC);
const donor = new PublicKey("3JF3sEqM796hk5WFqA6EtmEwJQ9quALszsfJyvXNQKy3"); // no funds, on purpose
const recipient = new PublicKey("4Ss5JMkXAD9Z7cktFEdrqeMuT6jGMF1pVozTyPHZ6zT4");
const donorAta = getAssociatedTokenAddressSync(USDC_KEY, donor);
const recipientAta = getAssociatedTokenAddressSync(USDC_KEY, recipient);
const evAuth = PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], new PublicKey(APP_SPLITTER))[0];

async function simulate(label, instructions, structuralPattern) {
  const tx = new Transaction().add(...instructions);
  tx.feePayer = donor;
  tx.recentBlockhash = (await rpc("getLatestBlockhash", [{ commitment: "confirmed" }])).value.blockhash;
  const sim = await rpc("simulateTransaction", [
    tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
    { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true },
  ]);
  const err = JSON.stringify(sim?.value?.err ?? null);
  const logs = (sim?.value?.logs ?? []).join("\n");
  const structural = structuralPattern.test(logs + err);
  check(`${label} decodes on chain (err=${err})`, !structural, logs.slice(0, 400));
  return logs;
}

const donateIx = new TransactionInstruction({
  programId: new PublicKey(APP_SPLITTER),
  data: Buffer.concat([Buffer.from("79badad34946c4b4", "hex"), u64le(1_000_000)]),
  keys: [
    { pubkey: donor, isSigner: true, isWritable: false },
    { pubkey: donorAta, isSigner: false, isWritable: true },
    { pubkey: recipientAta, isSigner: false, isWritable: true },
    { pubkey: USDC_KEY, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: evAuth, isSigner: false, isWritable: false },
    { pubkey: new PublicKey(APP_SPLITTER), isSigner: false, isWritable: false },
  ],
});
const donateLogs = await simulate(
  "donate",
  [
    createAssociatedTokenAccountIdempotentInstruction(donor, recipientAta, recipient, USDC_KEY),
    createAssociatedTokenAccountIdempotentInstruction(donor, donorAta, donor, USDC_KEY),
    donateIx,
  ],
  /InvalidInstructionData|invalid program argument|incorrect program id|AccountNotEnoughKeys|ConstraintTokenMint|ConstraintTokenOwner/i
);

// create_escrow: the arguments lead with the salt, and the PDA is derived from
// it — so a wrong argument order shows up as a seeds constraint, not as silence.
//
// The donor here is the fee wallet: it has no SOL (so the simulation still dies
// at money, as it must) but it DOES have a USDC account on devnet, which is what
// lets Anchor get all the way through account validation — seeds, the vault's
// derived address, the mint constraint — before it stops. With an empty wallet
// the run ended at `AccountNotInitialized` on the donor's token account, which
// proves rather less.
const resolver = new PublicKey("11111111111111111111111111111112");
const feeWallet = new PublicKey(APP_FEE_WALLET);
const escrowDonor = feeWallet;
const escrowDonorAta = getAssociatedTokenAddressSync(USDC_KEY, escrowDonor);
const gross = 1_000_000n;
const deadline = BigInt(Math.floor(Date.now() / 1000) + 30 * 86400);
const nonce = 7n;
const salt = saltOf(escrowDonor.toBuffer(), recipient.toBuffer(), gross, deadline, resolver.toBuffer(), Number(APP_FEE_BPS), feeWallet.toBuffer(), nonce);
const escrow = PublicKey.findProgramAddressSync([Buffer.from("escrow"), salt], new PublicKey(APP_FACTORY))[0];
const vault = getAssociatedTokenAddressSync(USDC_KEY, escrow, true);
const createIx = new TransactionInstruction({
  programId: new PublicKey(APP_FACTORY),
  data: Buffer.concat([
    Buffer.from("fdd7a574246c4450", "hex"),
    salt,
    recipient.toBuffer(),
    u64le(gross),
    i64le(deadline),
    resolver.toBuffer(),
    u16le(Number(APP_FEE_BPS)),
    feeWallet.toBuffer(),
    u64le(nonce),
  ]),
  keys: [
    { pubkey: escrowDonor, isSigner: true, isWritable: true },
    { pubkey: escrow, isSigner: false, isWritable: true },
    { pubkey: vault, isSigner: false, isWritable: true },
    { pubkey: escrowDonorAta, isSigner: false, isWritable: true },
    { pubkey: USDC_KEY, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
});
await simulate(
  "create_escrow",
  [createIx],
  // Every one of these means the CLIENT is wrong, not the wallet:
  //   InstructionDidNotDeserialize / InvalidInstructionData — the argument layout,
  //   ConstraintSeeds (2006) — the escrow PDA or the salt that seeds it,
  //   AccountNotInitialized (3012) — an account we derived that does not exist,
  //   SaltMismatch (6002) — our hash disagrees with the program's.
  /InvalidInstructionData|InstructionDidNotDeserialize|Fallback functions are not supported|ConstraintSeeds|AccountNotInitialized|SaltMismatch|custom program error: 0x1772/i
);

console.log("── donate sim logs (tail):");
console.log(donateLogs.split("\n").slice(-6).join("\n"));
if (skipped) console.log(`\n${skipped} check(s) skipped — clone the perimeter repos next to this one to run them.`);

process.exit(failed ? 1 : 0);
