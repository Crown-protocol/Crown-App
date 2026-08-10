// End-to-end check of the Crown DB pipeline + wallet-signature auth over the
// RUNNING dev server. Run: node scripts/verify-db.mjs
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";

const BASE = (process.env.CHEER_BASE ?? process.env.CROWN_BASE) || "http://localhost:3000";

// The synthetic-donation hook is locked behind CROWN_TEST_SECRET (dev-only + secret header).
// Read the same value the dev server loaded from .env.local so `node scripts/verify-db.mjs`
// works out of the box; env var wins if set. Empty = the hook stays locked and its checks skip.
const TEST_SECRET =
  (process.env.CHEER_TEST_SECRET ?? process.env.CROWN_TEST_SECRET) ||
  (() => {
    try {
      return (readFileSync(new URL("../.env.local", import.meta.url), "utf8").match(/^(?:CHEER|CROWN)_TEST_SECRET=(.+)$/m) || [])[1] || "";
    } catch {
      return "";
    }
  })();
const TEST_HDR = TEST_SECRET ? { "x-cheer-test-secret": TEST_SECRET } : {};

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
  new TextEncoder().encode(`cheer-app:${action}:${subject.toLowerCase()}:${ts}:${body === null ? "-" : sha256Hex(JSON.stringify(body))}`);
const signHeaders = (kp, action, subject, body) => {
  const ts = Math.floor(Date.now() / 1000);
  const sig = nacl.sign.detached(authMsg(action, subject, ts, body), kp.secretKey);
  return { "x-cheer-pubkey": kp.publicKey.toBase58(), "x-cheer-ts": String(ts), "x-cheer-signature": Buffer.from(sig).toString("base64") };
};

const run = randomBytes(4).toString("hex");
const H = `dbcheck${run}`; // unique handle per run — rate-limit friendly, no state bleed
const OWNER = Keypair.generate();
const STRANGER = Keypair.generate();
const STREAMER_ADDR = OWNER.publicKey.toBase58();
// A full keypair, not just an address: /api/donations/intent now requires the PAYER to sign for the
// caption, so the script has to be able to produce that proof like a real donor's wallet does.
const DONOR_KP = Keypair.generate();
const DONOR = DONOR_KP.publicKey.toBase58();
// The intent proof: a plain ed25519 signature over cheer-app:intent:<txSig>:<ts>:-
const intentBody = (kp, txSig, extra = {}) => {
  const ts = Math.floor(Date.now() / 1000);
  const msg = new TextEncoder().encode(`cheer-app:intent:${txSig.toLowerCase()}:${ts}:-`);
  return {
    signature: txSig,
    payer: kp.publicKey.toBase58(),
    ts,
    proof: Buffer.from(nacl.sign.detached(msg, kp.secretKey)).toString("base64"),
    ...extra,
  };
};
const mkProfile = (over = {}) => ({
  handle: H, name: "DB Check", bio: "verify", address: STREAMER_ADDR,
  socials: [], tiers: [{ name: "Newcomer", threshold: 0, color: "#9AA0AE" }], ...over,
});

// ── 1. Ownership rules on profiles
// Pages nobody owns are gone: an unsigned create is refused whatever address it
// carries, so this is now the same rule as the line below rather than its exception.
check("address-less page: unsigned create REJECTED (400)", (await post("/api/profiles", mkProfile({ handle: H + "demo", address: "" }))).status === 400);
check("real page: unsigned create REJECTED (401)", (await post("/api/profiles", mkProfile())).status === 401);
check("real page: signed create ok", (await post("/api/profiles", mkProfile(), signHeaders(OWNER, "profile", H, mkProfile()))).body?.ok === true);
check("owned page: unsigned update REJECTED (403)", (await post("/api/profiles", mkProfile({ bio: "hack" }))).status === 403);
const hackBody = mkProfile({ bio: "hack" });
check("owned page: STRANGER's signature REJECTED (403)", (await post("/api/profiles", hackBody, signHeaders(STRANGER, "profile", H, hackBody))).status === 403);
const updBody = mkProfile({ bio: "updated" });
check("owned page: owner's update ok", (await post("/api/profiles", updBody, signHeaders(OWNER, "profile", H, updBody))).body?.ok === true);
check("stale timestamp REJECTED", (await post("/api/profiles", updBody, { ...signHeaders(OWNER, "profile", H, updBody), "x-cheer-ts": String(Math.floor(Date.now() / 1000) - 3600) })).status === 403);
check("garbage payout address REJECTED (400)", (await post("/api/profiles", mkProfile({ handle: H + "bad", address: "0xdead" }))).status === 400);

// ── 2. Texts follow page ownership
check("texts: unsigned write to owned page REJECTED", (await post("/api/texts", { id: "t" + run, game: "task", handle: H, body: "X" })).status === 403);
const textBody = { id: "t" + run, game: "task", handle: H, body: "Beat the boss" };
check("texts: owner-signed write ok", (await post("/api/texts", textBody, signHeaders(OWNER, "text", H, textBody))).body?.ok === true);
check("texts: readable", (await j(`/api/texts?handle=${H}&game=task`)).body?.texts?.some((t) => t.body === "Beat the boss"));

// ── 3. Donation pipeline: intent → synthetic Settled → feed + reputation
const SIG = "VERIFYDB" + run;
// Words are the paid half of the product: the server reads the transaction and
// refuses a caption for a donation that never sent us the fee. A synthetic
// signature has paid nothing, so 402 IS the pass here — and the check is worth
// keeping precisely because it is what stops the fee being optional in practice.
check("intent: refused when the donation paid no fee (402)", (await post("/api/donations/intent", intentBody(DONOR_KP, SIG, { handle: H, name: "Max", message: "gg" }))).status === 402);
// The caption is the donor's to write: without a proof from the paying wallet, anyone who saw the
// public tx signature could attach their own name and message to someone else's donation.
check("intent: refused without proof", (await post("/api/donations/intent", { signature: SIG + "X", handle: H, name: "Impostor" })).status === 401);
// A stranger CAN sign — for their own key. What they can't do is make that signature verify against
// the payer this row claims, so the row is refused rather than silently mis-attributed.
{
  const forged = intentBody(STRANGER, SIG + "Y", { handle: H, name: "Impostor" });
  forged.payer = DONOR; // claim the real donor's wallet, sign with the stranger's
  check("intent: refused with a stranger's proof", (await post("/api/donations/intent", forged)).status === 401);
}
const ins = await post("/api/indexer", { test: { signature: SIG, slot: 1, payer: DONOR, streamer: STREAMER_ADDR, gross: 25_000_000 } }, TEST_HDR);
// The synthetic-insert path is double-locked: refused in production (NODE_ENV=production) and,
// even in dev, gated by CROWN_TEST_SECRET. A 403 here (prod build, or the secret not shared) means
// the four pipeline checks are SKIPPED, not failed — they need `next dev` with the secret set.
if (ins.status === 403) {
  const why = /disabled/i.test(JSON.stringify(ins.body)) ? "set CHEER_TEST_SECRET (server + this script) and run against `next dev`" : "indexer test hook is dev-only; run against `next dev`";
  skip("synthetic Settled inserted via real path", why);
  skip("duplicate signature is a no-op", "depends on synthetic insert");
  skip("feed row decorated by intent (Max/gg/$25)", "depends on synthetic insert");
  skip("reputation folded", "depends on synthetic insert");
} else {
  check("synthetic Settled inserted via real path", ins.body?.inserted === true, ins.body);
  check("duplicate signature is a no-op", (await post("/api/indexer", { test: { signature: SIG, slot: 1, payer: DONOR, streamer: STREAMER_ADDR, gross: 25_000_000 } }, TEST_HDR)).body?.inserted === false);
  const row = (await j(`/api/feed?handle=${H}`)).body?.donations?.find((d) => d.signature === SIG);
  // The donation lands in full — and lands WORDLESS, because the caption above was
  // refused for paying no fee. This pair is the whole product rule in one row:
  // the money is never ours to withhold, the words are never free.
  check(
    "feed row carries the donation, and no words we weren't paid for",
    row?.gross === 25_000_000 && row?.donorName === null && row?.message === null,
    row
  );
  check("reputation folded", (await j(`/api/reputation?payer=${DONOR}&streamer=${STREAMER_ADDR}`)).body?.total >= 25_000_000);

  // Cents must survive the whole way. Real donations are not whole dollars — the
  // first live one was $0.98 — and every screen that divided with `Math.floor`
  // showed it as $0. The pipeline is checked in minor units precisely so a
  // formatter can never be the thing that decides how much someone was paid.
  const CENTS_SIG = "VERIFYCENTS" + run;
  const centsIns = await post("/api/indexer", { test: { signature: CENTS_SIG, slot: 2, payer: DONOR, streamer: STREAMER_ADDR, gross: 980_000 } }, TEST_HDR);
  // Ask for the row by signature rather than trusting it to be inside a page of
  // the feed: this stack now has real donations in it, and a default page size is
  // not a promise about where a specific row lands.
  const centsFeed = await j(`/api/feed?handle=${H}&limit=200`);
  const centsRow = centsFeed.body?.donations?.find((d) => d.signature === CENTS_SIG);
  check("a sub-dollar donation keeps its cents end to end", centsRow?.gross === 980_000, JSON.stringify({ inserted: centsIns.body, found: centsRow }).slice(0, 200));
}

// ── 4. Delete: unsigned refused on owned, owner allowed
check("owned page: unsigned DELETE REJECTED", (await j(`/api/profiles/${H}`, { method: "DELETE" })).status === 403);
check("owned page: owner DELETE ok", (await j(`/api/profiles/${H}`, { method: "DELETE", headers: signHeaders(OWNER, "delete", H, null) })).body?.ok === true);

// ── 5. Health + rate limit
check("/api/health ok", (await j("/api/health")).body?.ok === true);
let limited = false;
// Spammed against `texts`, and the choice matters twice over. Not `profiles`:
// every check above depends on that bucket, and draining it made the NEXT run of
// this script fail on its own leftovers. Not `intent` either, any more: it now
// reads the transaction from the chain before answering, so 45 requests take long
// enough for the bucket to refill mid-loop and the limiter never trips — the test
// would be measuring RPC latency, not the limiter.
for (let i = 0; i < 40; i++) {
  const r = await post("/api/texts", { id: `rl${run}-${i}`, game: "task", handle: H, body: "x" });
  if (r.status === 429) { limited = true; break; }
}
check("rate limit kicks in on write spam (429)", limited);

const tail = skipped ? ` (${skipped} skipped — dev-only pipeline, run against \`next dev\`)` : "";
console.log(failed ? `\n${failed} FAILED${tail}` : `\nВСЕ ПРОВЕРКИ ПРОШЛИ${tail}`);
process.exit(failed ? 1 : 0);
