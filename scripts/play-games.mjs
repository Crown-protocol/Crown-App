// Play every game for real, in a browser, with real devnet money.
//
// `verify:ui` walks the site wallet-less and stops at the confirmation — which
// is the right place to stop when the question is "does the interface work".
// This script answers the other question: does a donation actually leave the
// wallet, does the escrow appear on Solana, does the canister see it. It signs
// with a real keypair (`scripts/e2e-wallet.mjs`) and spends real devnet USDC.
//
// Run: node scripts/play-games.mjs [task|fundraiser|roulette|all]
// Needs: the site on :3000, a local replica with the two game canisters (else
// the pages fall back to their preview path and say so), and a funded devnet
// keypair at ~/.config/solana/crown-index-e2e-donor.json.
import { chromium } from "playwright";
import { installWallet, readKeypair } from "./e2e-wallet.mjs";
import { execSync } from "node:child_process";

const BASE = process.env.CROWN_BASE || "http://localhost:3000";
const HANDLE = process.env.CROWN_PLAY_HANDLE || "playcheck";
// The donor's wallet. Overridable because one of the three games needs a donor
// who is NOT the page: a direct donation to your own address moves nothing and
// the app says so, which is right — but it means the wheel cannot be played
// from the page owner's own key.
const KEY = process.env.CROWN_PLAY_KEY || `${process.env.HOME}/.config/solana/crown-index-e2e-donor.json`;
const which = (process.argv[2] || "all").toLowerCase();

let failed = 0;
const skip = (name, why) => console.log(`⊘ ${name} — SKIPPED (${why})`);
const check = (name, ok, got = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : ` — ${got}`}`);
  if (!ok) failed++;
};
const usdc = () =>
  Number(
    execSync(
      `spl-token balance 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU --owner ${KEY} --url devnet`,
      { encoding: "utf8" }
    ).trim()
  );

const kp = readKeypair(KEY);
const address = execSync(`solana address -k ${KEY}`, { encoding: "utf8" }).trim();

// The page's own wallet. The maker and the donor are different people whenever
// `CROWN_PLAY_KEY` is set — which the wheel requires, since a donation to your
// own address moves nothing — so opening a round has to be done as the owner.
const OWNER_KEY = `${process.env.HOME}/.config/solana/crown-index-e2e-donor.json`;
const ownerKp = readKeypair(OWNER_KEY);
const ownerAddress = execSync(`solana address -k ${OWNER_KEY}`, { encoding: "utf8" }).trim();

async function page(browser, who = { ...kp, address }) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
  const p = await ctx.newPage();
  await installWallet(p, who);
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  p.on("console", (m) => m.type() === "error" && !/DevTools|plugin data|Failed to load resource/i.test(m.text()) && errors.push(m.text()));
  // "Failed to load resource" without the resource is not a report — the URL and
  // the body are what say whether the run hit a real refusal or a poll of an
  // endpoint that is allowed to say no.
  p.on("response", async (r) => {
    // 425 on the intent is the contract, not a fault: the name is offered before
    // the cluster finalizes the payment and the client keeps offering it.
    if (r.status() === 425) return;
    if (r.status() >= 400 && r.url().startsWith(BASE)) {
      errors.push(`${r.status()} ${r.url().replace(BASE, "")} ${(await r.text().catch(() => "")).slice(0, 120)}`);
    }
  });
  return { ctx, p, errors };
}

const settle = async (p, ms = 3000) => p.waitForTimeout(ms);

/**
 * The smallest amount the game accepts, typed into the custom field.
 *
 * The presets are what a real viewer clicks ($10 and up); a run that pays them
 * empties a devnet purse in three goes and then fails as "Simulation failed",
 * which reads like a broken page and is only an empty wallet. One dollar is the
 * floor the interface actually has: the protocol's devnet floor is $0.25, but
 * every form rounds a custom amount to whole dollars, so anything smaller
 * arrives as $0 and the button stays off.
 */
const AMOUNT = "1";
async function payLittle(p) {
  const custom = p.locator("input[type=number]:visible").first();
  if (!(await custom.count())) return false;
  await custom.fill(AMOUNT);
  await p.waitForTimeout(400);
  return true;
}

/**
 * Connect the wallet the way a visitor does.
 *
 * The app only auto-reconnects on the pages a maker uses (`/space`, `/create`,
 * `/me`); on a game page a donor is expected to press the button, and the
 * wallet chooser opens because more than one wallet can be installed. Skipping
 * that click left every flow at "Connect your wallet — tasks here are real
 * escrow", which is the app being right and the script being lazy.
 */
async function connect(p) {
  const btn = p.getByRole("button", { name: /connect wallet/i }).first();
  if (!(await btn.count())) return true;
  await btn.click().catch(() => {});
  await p.waitForTimeout(800);
  const phantom = p.getByRole("button", { name: /phantom/i }).first();
  if (await phantom.count()) {
    await phantom.click().catch(() => {});
  }
  for (let i = 0; i < 20; i++) {
    await p.waitForTimeout(500);
    if (!(await p.getByRole("button", { name: /connect wallet/i }).count())) return true;
  }
  return false;
}

/**
 * Click through the app's own confirmation dialog.
 *
 * The affirmative button is worded per game ("Pay $1", "Chip in $1", "Back it"),
 * so it is found by elimination — the dialog's own button that is not Cancel —
 * rather than by a list of words that will always be one game behind.
 */
async function confirmIt(p) {
  // Inside the dialog when there is one, and only then anywhere else.
  //
  // The affirmative is worded per game ("Pay $1", "Chip in $1", "Back it · $1"),
  // so it is found by elimination rather than by a list of words that will always
  // be one game behind. But elimination has to be SCOPED: "the last button on the
  // page that is not Cancel" once landed on the cabinet's "End session" after a
  // confirmation had already closed, which ended a live run instead of confirming
  // anything. A destructive click is not an acceptable failure mode for a helper
  // whose whole job is pressing the safe one.
  const dialog = p.locator("[role=dialog]").last();
  const scope = (await dialog.count()) ? dialog : null;
  const cancel = (scope ?? p).getByRole("button", { name: /^cancel$/i });
  if (!(await cancel.count())) return false;
  const buttons = (scope ?? p).getByRole("button");
  for (let i = (await buttons.count()) - 1; i >= 0; i--) {
    const t = (await buttons.nth(i).innerText().catch(() => "")).trim();
    if (t && !/^cancel$/i.test(t)) {
      await buttons.nth(i).click().catch(() => {});
      return true;
    }
  }
  return false;
}

/**
 * The maker's half: open a wheel on chain so there is something to stake on.
 *
 * A round has a committed close slot, so it expires — and a run that only ever
 * plays the donor's half has nothing to play once it does. This opens one the
 * way the cabinet does, with the page owner's own wallet.
 */
async function openRound(browser) {
  console.log("\n— maker: open a round on chain —");
  const { ctx, p } = await page(browser, { ...ownerKp, address: ownerAddress });
  try {
    await p.addInitScript(
      (prof) => localStorage.setItem("cheer-profile", prof),
      JSON.stringify({ handle: HANDLE, name: "Play Check", address: ownerAddress })
    );
    await p.goto(`${BASE}/space`, { waitUntil: "domcontentloaded" });
    await settle(p, 6000);
    const again = p.getByRole("button", { name: /sign again/i }).first();
    if (await again.count()) {
      await again.click();
      await settle(p, 6000);
    }
    const roulette = p.locator("button, a").filter({ hasText: /^Roulette$/ }).first();
    if (await roulette.count()) {
      await roulette.click();
      await settle(p, 3000);
    }
    const overview = p.locator("button, a").filter({ hasText: /^Overview$/ }).first();
    if (await overview.count()) {
      await overview.click();
      // The chain cabinet only knows whether the last round is finished once it
      // has read the wheel, and that read walks the chain — several seconds on a
      // good day. Looking for the control before then finds the old round's card
      // and calls it success.
      await settle(p, 12000);
    }
    const open = p.locator("button").filter({ hasText: /sign and open/i }).first();
    if (!(await open.count())) {
      const body = await p.innerText("body");
      return check("maker: a round is open", /round on chain/i.test(body), "no way to open one and none running");
    }
    await open.click();
    await settle(p, 20000);
    check("maker: a round is open", /round on chain/i.test(await p.innerText("body")), "the round did not open");
  } finally {
    await ctx.close();
  }
}

/**
 * The cabinet's floor knobs, driven below the floor.
 *
 * Spends nothing, and belongs here rather than in `verify:ui` for one reason:
 * these screens need a wallet, and that suite deliberately has none. What it
 * asserts is the pair — the value SNAPS to the network's floor, and the person
 * is TOLD it did. The snap alone had been true for a while and the telling had
 * quietly stopped working, which is the worst of the two halves to lose: a field
 * that silently rewrites what you typed reads as a field that ignored you.
 */
async function checkFloors(browser) {
  console.log("\n— cabinet: the floor knobs —");
  const { ctx, p } = await page(browser, { ...ownerKp, address: ownerAddress });
  try {
    await p.addInitScript(
      (prof) => localStorage.setItem("cheer-profile", prof),
      JSON.stringify({ handle: HANDLE, name: "Play Check", address: ownerAddress })
    );
    await p.goto(`${BASE}/space`, { waitUntil: "domcontentloaded" });
    await settle(p, 6000);
    const again = p.getByRole("button", { name: /sign again/i }).first();
    if (await again.count()) {
      await again.click();
      await settle(p, 6000);
    }
    // The rules live one level in: sidebar game → Page → the builder's Rules tab.
    // Each minimum is addressed by its own id, so this cannot drift onto some
    // other number field and call it a pass.
    for (const [game, id] of [
      ["Task for donation", "#task-min"],
      ["Roulette", "#roul-min"],
      ["Fundraiser", "#fr-min"],
    ]) {
      const section = p.locator("button, a").filter({ hasText: new RegExp(`^${game}$`) }).first();
      if (!(await section.count())) {
        skip(`floors: ${game}`, "no such section");
        continue;
      }
      await section.click();
      await settle(p, 2500);
      // Page first: a game with no run says so *there*, and that is where the
      // "create a session" control lives. Looking for it before opening the tab
      // finds whatever the previous game left on screen.
      const openPage = async () => {
        const tab = p.locator("button, a").filter({ hasText: /^Page$/ }).first();
        if (await tab.count()) {
          await tab.click();
          await settle(p, 2500);
        }
      };
      await openPage();
      const starter = p
        .locator("button")
        .filter({ hasText: /start a new session|create a session|start a session/i })
        .first();
      if (await starter.count()) {
        await starter.click();
        await settle(p, 2500);
        const dialog = p.locator("[role=dialog]").last();
        const buttons = dialog.getByRole("button");
        const n = await buttons.count();
        for (let i = n - 1; i >= 0; i--) {
          const t = (await buttons.nth(i).innerText().catch(() => "")).trim();
          if (t && !/^cancel$/i.test(t)) {
            await buttons.nth(i).click().catch(() => {});
            break;
          }
        }
        await settle(p, 15000);
        await openPage();
      }
      const rulesTab = p.locator("button").filter({ hasText: /^Rules$/ }).first();
      if (await rulesTab.count()) {
        await rulesTab.click();
        await settle(p, 2000);
      }
      const field = p.locator(id).first();
      if (!(await field.count())) {
        skip(`floors: ${game}`, `${id} is not on this screen`);
        console.log("     screen:", (await p.innerText("body")).replace(/\s+/g, " ").slice(0, 400));
        continue;
      }
      await field.fill("0");
      await field.blur();
      await settle(p, 900);
      const kept = Number(await field.inputValue());
      // The builder re-renders its live preview on every keystroke; give it a
      // beat so the screenshot shows the settled screen rather than a frame
      // caught mid-reload.
      await settle(p, 3000);
      const body = await p.innerText("body");
      check(`floors: ${game} refuses a minimum under the network's`, kept > 0, `kept ${kept}`);
      check(`floors: ${game} says it raised the number`, /raised to/i.test(body), "no notice on screen");
      await p.screenshot({
        path: `/tmp/claude-1000/-home-jab-crown/7e5a0ec1-ccfb-48eb-9c1e-800666c5ac21/scratchpad/floor-${id.slice(1)}.png`,
        fullPage: true,
      });
    }
  } finally {
    await ctx.close();
  }
}

async function playTask(browser) {
  console.log("\n— task: a paid task with real escrow —");
  const before = usdc();
  const { ctx, p, errors } = await page(browser);
  try {
    await p.goto(`${BASE}/@${HANDLE}/task`, { waitUntil: "domcontentloaded" });
    await settle(p, 5000);
    check("task: the wallet connects", await connect(p), "still asking to connect");
    await payLittle(p);
    const fields = p.locator("input[type=text]:visible, textarea:visible");
    for (let i = 0; i < (await fields.count()); i++) {
      await fields.nth(i).fill(i === 0 ? "E2E" : "Play the wheel game on stream").catch(() => {});
    }
    const cta = p.locator("button.btn").filter({ hasText: /\$/ }).first();
    check("task: the button is live once the form is filled", !(await cta.isDisabled()), "still disabled");
    await cta.click();
    await settle(p, 1200);
    const dialog = await p.innerText("body");
    check("task: the confirmation is the real-escrow one, not the demo one", /escrow/i.test(dialog), dialog.slice(0, 160));
    await confirmIt(p);
    // The escrow is born on Solana, then the canister is asked to register it.
    await settle(p, 25000);
    const body = await p.innerText("body");
    const spent = before - usdc();
    check("task: money actually left the wallet", spent > 0, `balance unchanged (${before})`);
    check("task: the page did not error out", errors.length === 0, errors.slice(0, 2).join(" | "));
    // What the page kept: the scope id the canister answers to and the escrow the
    // money sits in. Printed so the run can be checked against the canister and
    // against Solana by hand, which is the only proof that counts.
    const kept = await p.evaluate(() => {
      const out = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith("cheer-tasks")) out.push(localStorage.getItem(k));
      }
      return out.join("\n");
    });
    console.log(`   spent $${spent.toFixed(3)}`);
    console.log(`   stored: ${kept.slice(0, 600) || "(nothing)"}`);
    console.log(`   page: ${body.split("\n").filter((l) => /task|escrow|error|sent|waiting/i.test(l)).slice(0, 3).join(" / ")}`);
  } finally {
    await ctx.close();
  }
}

async function playFundraiser(browser) {
  console.log("\n— fundraiser: a chip-in with real escrow —");
  const before = usdc();
  const { ctx, p, errors } = await page(browser);
  // Kept so a failed materialization can be replayed by hand against a fresher
  // root instead of being re-paid for.
  p.on("request", (r) => {
    if (r.url().endsWith("/api/collection/materialize")) console.log("   materialize body:", r.postData());
  });
  try {
    await p.goto(`${BASE}/@${HANDLE}/fundraiser`, { waitUntil: "domcontentloaded" });
    await settle(p, 5000);
    check("fundraiser: the wallet connects", await connect(p), "still asking to connect");
    await payLittle(p);
    const preview = /preview/i.test(await p.innerText("body"));
    check("fundraiser: not in preview (the collection is on chain)", !preview, "still the preview path — no on-chain collection");
    const cta = p.locator("button.btn").filter({ hasText: /\$/ }).first();
    if (!(await cta.count())) return check("fundraiser: has a chip-in button", false, "none found");
    check("fundraiser: the chip-in button is live", !(await cta.isDisabled()), `"${await cta.innerText()}" is disabled`);
    await cta.click();
    await settle(p, 1200);
    await confirmIt(p);
    await settle(p, 25000);
    const spent = before - usdc();
    check("fundraiser: money actually left the wallet", spent > 0, `balance unchanged (${before})`);
    check("fundraiser: the page did not error out", errors.length === 0, errors.slice(0, 2).join(" | "));
    console.log(`   spent $${spent.toFixed(3)}`);
  } finally {
    await ctx.close();
  }
}

async function playRoulette(browser) {
  console.log("\n— roulette: a stake on the chain wheel —");
  const before = usdc();
  const { ctx, p, errors } = await page(browser);
  try {
    await p.goto(`${BASE}/@${HANDLE}/roulette`, { waitUntil: "domcontentloaded" });
    await settle(p, 5000);
    check("roulette: the wallet connects", await connect(p), "still asking to connect");
    await payLittle(p);
    const body = await p.innerText("body");
    if (!/round/i.test(body)) return check("roulette: a round is open", false, "no round on this page");
    const title = p.locator("input[type=text]:visible").first();
    if (await title.count()) await title.fill("Factorio").catch(() => {});
    const cta = p.locator("button.btn").filter({ hasText: /back it|\$/i }).first();
    check("roulette: the stake button is live", !(await cta.isDisabled()), `"${await cta.innerText()}" is disabled`);
    await cta.click();
    await settle(p, 1200);
    check("roulette: the confirmation was clicked", await confirmIt(p), "no dialog appeared");
    // Long enough for the donation's name to be accepted: the intent is retried
    // until the cluster finalizes the transaction (~13s), so a shorter wait
    // closes the browser mid-retry and reports a failure the site does not have.
    await settle(p, 45000);
    const spent = before - usdc();
    check("roulette: money actually left the wallet", spent > 0, `balance unchanged (${before})`);
    console.log(`   page: ${(await p.innerText("body")).split("\n").filter((l) => /error|wallet|stake|counted|sending/i.test(l)).slice(0, 3).join(" / ")}`);
    check("roulette: the page did not error out", errors.length === 0, errors.slice(0, 2).join(" | "));
    console.log(`   spent $${spent.toFixed(3)}`);
  } finally {
    await ctx.close();
  }
}

const purse = usdc();
console.log(`playing as ${address} — $${purse} devnet USDC, @${HANDLE}`);
// The forms round a custom amount to whole dollars (a product decision, not a
// limit of the protocol — the devnet floor is $0.25), so a play costs $1 even at
// its smallest. Said here rather than discovered as "Simulation failed", which
// is what an empty wallet looks like from inside the page.
if (purse < 1) {
  console.error(
    `\n✗ not enough devnet USDC: the games round to whole dollars, so one play needs $1 and this wallet holds $${purse}.` +
      `\n  Top up at https://faucet.circle.com (Solana Devnet, address ${address}) and run this again.`
  );
  process.exit(1);
}
const browser = await chromium.launch();
try {
  if (which === "open-round") await openRound(browser);
  if (which === "floors") await checkFloors(browser);
  if (which === "all" || which === "task") await playTask(browser);
  if (which === "all" || which === "fundraiser") await playFundraiser(browser);
  if (which === "all" || which === "roulette") {
    // A wheel that has already closed cannot be staked on; open one first.
    const live = await fetch(`${BASE}/api/roulette/round?handle=${HANDLE}`).then((r) => r.json()).catch(() => null);
    const wheel = live?.rounds?.[0]
      ? await fetch(`${BASE}/api/roulette/wheel?round=${live.rounds[0].roundHex}`).then((r) => r.json()).catch(() => null)
      : null;
    if (!wheel?.wheel || wheel.wheel.winner || wheel.wheel.currentSlot >= live.rounds[0].closeSlot) await openRound(browser);
    await playRoulette(browser);
  }
} finally {
  await browser.close();
}
console.log(failed ? `\n✗ ${failed} проверок упало` : "\nВСЕ ИГРЫ СЫГРАНЫ");
process.exit(failed ? 1 : 0);
