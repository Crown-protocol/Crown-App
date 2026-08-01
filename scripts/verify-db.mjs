// End-to-end check of the Crown DB pipeline + wallet-signature auth over the
// RUNNING dev server. Run: node scripts/verify-db.mjs
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";

const BASE = process.env.CROWN_BASE || "http://localhost:3000";
const DEMO_ADDRESS = "CrownDemo1111111111111111111111111111111111";

// The synthetic-donation hook is locked behind CROWN_TEST_SECRET (dev-only + secret header).
// Read the same value the dev server loaded from .env.local so `node scripts/verify-db.mjs`
// works out of the box; env var wins if set. Empty = the hook stays locked and its checks skip.
const TEST_SECRET =
  process.env.CROWN_TEST_SECRET ||
  (() => {
    try {
      return (readFileSync(new URL("../.env.local", import.meta.url), "utf8").match(/^CROWN_TEST_SECRET=(.+)$/m) || [])[1] || "";
    } catch {
      return "";
    }
  })();
const TEST_HDR = TEST_SECRET ? { "x-crown-test-secret": TEST_SECRET } : {};

let failed = 0;
let skipped = 0;
const check = (name, ok, got = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)}`}`);
  if (!ok) failed++;
};
const skip = (name, why) => {
  console.log(`⊘ ${name} — SKIPPED (${why})`);
  skipped++;
};

const j = async (path, init) => {
  const r = await fetch(BASE + path, init);
  return { status: r.status, body: await r.json().catch(() => null) };
};
const post = (path, body, headers = {}) =>
  j(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

// Mirror of lib/chain/authMessage.ts
const sha256Hex = (s) => createHash("sha256").update(s).digest("hex");
const authMsg = (action, subject, ts, body) =>
  new TextEncoder().encode(`crown-app:${action}:${subject.toLowerCase()}:${ts}:${body === null ? "-" : sha256Hex(JSON.stringify(body))}`);
const signHeaders = (kp, action, subject, body) => {
  const ts = Math.floor(Date.now() / 1000);
  const sig = nacl.sign.detached(authMsg(action, subject, ts, body), kp.secretKey);
  return { "x-crown-pubkey": kp.publicKey.toBase58(), "x-crown-ts": String(ts), "x-crown-signature": Buffer.from(sig).toString("base64") };
};

const run = randomBytes(4).toString("hex");
const H = `dbcheck${run}`; // unique handle per run — rate-limit friendly, no state bleed
const OWNER = Keypair.generate();
const STRANGER = Keypair.generate();
const STREAMER_ADDR = OWNER.publicKey.toBase58();
const DONOR = Keypair.generate().publicKey.toBase58();
const mkProfile = (over = {}) => ({
  handle: H, name: "DB Check", bio: "verify", address: STREAMER_ADDR,
  socials: [], tiers: [{ name: "Newcomer", threshold: 0, color: "#9AA0AE" }], ...over,
});

// ── 1. Ownership rules on profiles
check("demo page: unsigned create allowed", (await post("/api/profiles", mkProfile({ handle: H + "demo", address: DEMO_ADDRESS }))).body?.ok === true);
check("real page: unsigned create REJECTED (401)", (await post("/api/profiles", mkProfile())).status === 401);
check("real page: signed create ok", (await post("/api/profiles", mkProfile(), signHeaders(OWNER, "profile", H, mkProfile()))).body?.ok === true);
check("owned page: unsigned update REJECTED (403)", (await post("/api/profiles", mkProfile({ bio: "hack" }))).status === 403);
const hackBody = mkProfile({ bio: "hack" });
check("owned page: STRANGER's signature REJECTED (403)", (await post("/api/profiles", hackBody, signHeaders(STRANGER, "profile", H, hackBody))).status === 403);
const updBody = mkProfile({ bio: "updated" });
check("owned page: owner's update ok", (await post("/api/profiles", updBody, signHeaders(OWNER, "profile", H, updBody))).body?.ok === true);
check("stale timestamp REJECTED", (await post("/api/profiles", updBody, { ...signHeaders(OWNER, "profile", H, updBody), "x-crown-ts": String(Math.floor(Date.now() / 1000) - 3600) })).status === 403);
check("garbage payout address REJECTED (400)", (await post("/api/profiles", mkProfile({ handle: H + "bad", address: "0xdead" }))).status === 400);

// ── 2. Texts follow page ownership
check("texts: unsigned write to owned page REJECTED", (await post("/api/texts", { id: "t" + run, game: "task", handle: H, body: "X" })).status === 403);
const textBody = { id: "t" + run, game: "task", handle: H, body: "Beat the boss" };
check("texts: owner-signed write ok", (await post("/api/texts", textBody, signHeaders(OWNER, "text", H, textBody))).body?.ok === true);
check("texts: readable", (await j(`/api/texts?handle=${H}&game=task`)).body?.texts?.some((t) => t.body === "Beat the boss"));

// ── 3. Donation pipeline: intent → synthetic Settled → feed + reputation
const SIG = "VERIFYDB" + run;
check("intent saved", (await post("/api/donations/intent", { signature: SIG, handle: H, name: "Max", message: "gg" })).body?.ok === true);
const ins = await post("/api/indexer", { test: { signature: SIG, slot: 1, payer: DONOR, streamer: STREAMER_ADDR, gross: 25_000_000 } }, TEST_HDR);
// The synthetic-insert path is double-locked: refused in production (NODE_ENV=production) and,
// even in dev, gated by CROWN_TEST_SECRET. A 403 here (prod build, or the secret not shared) means
// the four pipeline checks are SKIPPED, not failed — they need `next dev` with the secret set.
if (ins.status === 403) {
  const why = /disabled/i.test(JSON.stringify(ins.body)) ? "set CROWN_TEST_SECRET (server + this script) and run against `next dev`" : "indexer test hook is dev-only; run against `next dev`";
  skip("synthetic Settled inserted via real path", why);
  skip("duplicate signature is a no-op", "depends on synthetic insert");
  skip("feed row decorated by intent (Max/gg/$25)", "depends on synthetic insert");
  skip("reputation folded", "depends on synthetic insert");
} else {
  check("synthetic Settled inserted via real path", ins.body?.inserted === true, ins.body);
  check("duplicate signature is a no-op", (await post("/api/indexer", { test: { signature: SIG, slot: 1, payer: DONOR, streamer: STREAMER_ADDR, gross: 25_000_000 } }, TEST_HDR)).body?.inserted === false);
  const row = (await j(`/api/feed?handle=${H}`)).body?.donations?.find((d) => d.signature === SIG);
  check("feed row decorated by intent (Max/gg/$25)", row?.donorName === "Max" && row?.message === "gg" && row?.gross === 25_000_000, row);
  check("reputation folded", (await j(`/api/reputation?payer=${DONOR}&streamer=${STREAMER_ADDR}`)).body?.total >= 25_000_000);
}

// ── 4. Delete: unsigned refused on owned, owner allowed
check("owned page: unsigned DELETE REJECTED", (await j(`/api/profiles/${H}`, { method: "DELETE" })).status === 403);
check("owned page: owner DELETE ok", (await j(`/api/profiles/${H}`, { method: "DELETE", headers: signHeaders(OWNER, "delete", H, null) })).body?.ok === true);
await fetch(`${BASE}/api/profiles/${H}demo`, { method: "DELETE" }); // demo page — unsigned cleanup works by design

// ── 5. Health + rate limit
check("/api/health ok", (await j("/api/health")).body?.ok === true);
let limited = false;
for (let i = 0; i < 25; i++) {
  const r = await post("/api/donations/intent", { signature: "RL" + run + i, handle: H });
  if (r.status === 429) { limited = true; break; }
}
check("rate limit kicks in on write spam (429)", limited);

const tail = skipped ? ` (${skipped} skipped — dev-only pipeline, run against \`next dev\`)` : "";
console.log(failed ? `\n${failed} FAILED${tail}` : `\nВСЕ ПРОВЕРКИ ПРОШЛИ${tail}`);
process.exit(failed ? 1 : 0);
