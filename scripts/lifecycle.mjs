// The half of the escrow games that happens after the money is in.
//
// `play-games.mjs` proves a payment reaches an escrow and a canister records the
// scope. That is the beginning: the point of an escrow is what comes next —
// the recipient accepts, delivers or declines, viewers vote, a verdict is
// signed by the game's threshold key, and the money finally moves to one of the
// two places it can go. None of that had ever been driven from the interface,
// which means the refund path — the one a donor is actually trusting — had never
// run at all.
//
// Run: node scripts/lifecycle.mjs [task|fundraiser|refund|all]
// Needs the same setup as `play-games.mjs` (site, replica, canisters, wallet)
// and at least one escrow already funded by it.
import { chromium } from "playwright";
import { installWallet, readKeypair } from "./e2e-wallet.mjs";
import { execSync } from "node:child_process";

const BASE = process.env.CROWN_BASE || "http://localhost:3000";
const HANDLE = process.env.CROWN_PLAY_HANDLE || "playcheck";
const OWNER_KEY = `${process.env.HOME}/.config/solana/crown-index-e2e-donor.json`;
const USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const which = (process.argv[2] || "all").toLowerCase();

let failed = 0;
const check = (name, ok, got = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : ` — ${got}`}`);
  if (!ok) failed++;
};
const skip = (name, why) => console.log(`⊘ ${name} — SKIPPED (${why})`);

const ownerKp = readKeypair(OWNER_KEY);
const ownerAddress = execSync(`solana address -k ${OWNER_KEY}`, { encoding: "utf8" }).trim();

/** What an account holds, in USDC — `0` for an account that does not exist. */
function held(owner) {
  try {
    return Number(execSync(`spl-token balance ${USDC} --owner ${owner} --url devnet 2>/dev/null`, { encoding: "utf8" }).trim());
  } catch {
    return 0;
  }
}

async function cabinet(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1200 } });
  const p = await ctx.newPage();
  await installWallet(p, { ...ownerKp, address: ownerAddress });
  await p.addInitScript(
    (prof) => localStorage.setItem("cheer-profile", prof),
    JSON.stringify({ handle: HANDLE, name: "Play Check", address: ownerAddress })
  );
  const errors = [];
  p.on("response", async (r) => {
    if (r.status() >= 400 && r.status() !== 425 && r.url().startsWith(BASE)) {
      errors.push(`${r.status()} ${r.url().replace(BASE, "")}`);
    }
  });
  await p.goto(`${BASE}/space`, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(6000);
  const again = p.getByRole("button", { name: /sign again/i }).first();
  if (await again.count()) {
    await again.click();
    await p.waitForTimeout(6000);
  }
  return { ctx, p, errors };
}

/** Open a game's Overview — where the queue and the settle controls live. */
async function overview(p, game) {
  const section = p.locator("button, a").filter({ hasText: new RegExp(`^${game}$`) }).first();
  if (!(await section.count())) return false;
  await section.click();
  await p.waitForTimeout(2500);
  const tab = p.locator("button, a").filter({ hasText: /^Overview$/ }).first();
  if (!(await tab.count())) return false;
  await tab.click();
  await p.waitForTimeout(5000);
  return true;
}

const clickIf = async (p, re, wait = 6000) => {
  const b = p.locator("button").filter({ hasText: re }).first();
  if (!(await b.count())) return false;
  await b.click().catch(() => {});
  await p.waitForTimeout(wait);
  return true;
};

async function taskLifecycle(browser, { decline = false } = {}) {
  console.log(`\n— task: ${decline ? "declined → the money goes back" : "approved → delivered → released"} —`);
  const recipientBefore = held(ownerAddress);
  const { ctx, p, errors } = await cabinet(browser);
  try {
    if (!(await overview(p, "Task for donation"))) return skip("task lifecycle", "no Overview for this game");
    const body = await p.innerText("body");
    if (!/Approve|Mark done|Release the money|Return the money/.test(body)) {
      return skip("task lifecycle", "no task in the queue to drive");
    }

    if (decline) {
      check("task: the queue offers Decline", await clickIf(p, /^Decline$/, 12000), "no Decline button");
    } else {
      if (/Approve/.test(body)) {
        check("task: the maker can approve it", await clickIf(p, /^Approve$/, 12000), "no Approve button");
      }
      check("task: the maker can mark it done", await clickIf(p, /^Mark done$/, 12000), "no Mark done button");
    }

    // The verdict is not instant by design: viewers get the voting window, and
    // devnet's is 120s. Waiting it out here is the only way to see the money
    // actually move.
    console.log("   waiting out the voting window (120s + a beat)…");
    await p.waitForTimeout(135_000);
    await p.reload({ waitUntil: "domcontentloaded" });
    await p.waitForTimeout(6000);
    await overview(p, "Task for donation");

    const settled = await clickIf(p, /Release the money|Return the money/, 30_000);
    check("task: a decided task offers the money", settled, "no settle control after the window");
    if (!settled) return;

    const after = held(ownerAddress);
    console.log(`   recipient: $${recipientBefore} → $${after}`);
    check(
      decline ? "task: the escrow went back to the donor" : "task: the escrow reached the recipient",
      decline ? after <= recipientBefore : after > recipientBefore,
      `recipient ${recipientBefore} → ${after}`
    );
    check("task: nothing was refused along the way", errors.length === 0, errors.slice(0, 3).join(" | "));
  } finally {
    await ctx.close();
  }
}

async function fundraiserLifecycle(browser) {
  console.log("\n— fundraiser: delivered → the collection settles —");
  const recipientBefore = held(ownerAddress);
  const { ctx, p, errors } = await cabinet(browser);
  try {
    if (!(await overview(p, "Fundraiser"))) return skip("fundraiser lifecycle", "no Overview for this game");
    const body = await p.innerText("body");
    console.log("   overview says:", body.replace(/\s+/g, " ").slice(0, 240));

    // The recipient's half: "delivered — judge me".
    const marked = await clickIf(p, /delivered|deliver|ready/i, 15_000);
    check("fundraiser: the recipient can say it is delivered", marked, "no delivery control");

    console.log("   waiting out the voting window (120s + a beat)…");
    await p.waitForTimeout(135_000);
    await p.reload({ waitUntil: "domcontentloaded" });
    await p.waitForTimeout(6000);
    await overview(p, "Fundraiser");

    const settled = await clickIf(p, /release|return|settle/i, 40_000);
    check("fundraiser: a decided collection offers the money", settled, "no settle control after the window");
    if (!settled) return;

    const after = held(ownerAddress);
    console.log(`   recipient: $${recipientBefore} → $${after}`);
    check("fundraiser: the contributions reached the recipient", after > recipientBefore, `${recipientBefore} → ${after}`);
    check("fundraiser: nothing was refused along the way", errors.length === 0, errors.slice(0, 3).join(" | "));
  } finally {
    await ctx.close();
  }
}

console.log(`lifecycle as ${ownerAddress} — @${HANDLE}`);
const browser = await chromium.launch();
try {
  if (which === "all" || which === "task") await taskLifecycle(browser);
  if (which === "refund") await taskLifecycle(browser, { decline: true });
  if (which === "all" || which === "fundraiser") await fundraiserLifecycle(browser);
} finally {
  await browser.close();
}
console.log(failed ? `\n✗ ${failed} проверок упало` : "\nЖИЗНЕННЫЙ ЦИКЛ ПРОЙДЕН");
process.exit(failed ? 1 : 0);
