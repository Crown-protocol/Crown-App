// The site, driven the way a person drives it: every control clicked, on a real
// browser, against the RUNNING dev server. Run: node scripts/verify-ui.mjs
//
// The other three checks answer "is the arithmetic right" (`verify:games`), "is
// the chain what we say it is" (`verify:chain`) and "does the server refuse what
// it must" (`verify:db`). None of them can tell whether a button does anything.
// This one clicks them.
//
// What it asserts, in the order it matters:
//
//   1. nothing throws — no page error, no console error, no blank render;
//   2. every visible control has a NAME a person can read, and every input says
//      what it wants;
//   3. every enabled button DOES something — a control that changes nothing is
//      worse than no control, so "nothing happened" is a failure here, not a
//      shrug. The few genuinely inert ones (copy-to-clipboard, links dressed as
//      buttons) are named in INERT below rather than tolerated in general;
//   4. a disabled call-to-action is EXPLAINED on screen — a dead button with no
//      reason next to it is the worst state a page can be in;
//   5. the page fits a phone: no horizontal scroll at 390px;
//   6. the flows work end to end: pick a preset, type an amount, reach the
//      confirmation, back out of it, and land where you started.
//
// Wallet-less on purpose: this is what a first-time visitor sees. Anything that
// needs a signature must SAY so when clicked, and that is checked rather than
// worked around.
import { chromium } from "playwright";

const BASE = (process.env.CHEER_BASE ?? process.env.CROWN_BASE) || "http://localhost:3000";
/** The demo page the app ships with; override for a different fixture. */
const HANDLE = process.env.CROWN_UI_HANDLE || "jesusavgn";

let failed = 0;
let skipped = 0;
const check = (name, ok, got = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : ` — ${typeof got === "string" ? got : JSON.stringify(got)}`}`);
  if (!ok) failed++;
};
const skip = (name, why) => {
  console.log(`⊘ ${name} — SKIPPED (${why})`);
  skipped++;
};

// ──────────────────────────────────────────────────────────────────
// Noise the browser makes on its own, and which says nothing about the site:
// the headless shell's plugin probe trips our own CSP, and a dev build ships
// React's devtools nag. Everything else counts.
// ──────────────────────────────────────────────────────────────────
const IGNORED_CONSOLE = [
  /Download the React DevTools/i,
  /Loading plugin data from/i,
  /favicon/i,
  /\[Fast Refresh\]/i,
];

/**
 * Buttons that are allowed to leave the page looking identical.
 *
 * Every entry is a control whose whole effect is outside the DOM — the
 * clipboard, a wallet extension that is not installed, a file download. Adding a
 * name here is a decision that this control has nothing to show, so keep it
 * short and keep it honest.
 */
const INERT = [/copy/i, /download/i, /share/i, /export/i];

// ──────────────────────────────────────────────────────────────────
// What to walk, read from the app's own lists rather than typed out here.
//
// A suite that keeps its own copy of "the games" covers whatever it covered on
// the day it was written: add a fourth game and the check stays green while the
// new page is never opened. So the ids come out of `lib/data/games.ts` and the
// widget kinds out of `lib/data/overlays.ts` — by regex, because this script
// runs in bare Node and those modules are TypeScript.
// ──────────────────────────────────────────────────────────────────
import { readFileSync } from "node:fs";

const src = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const GAME_IDS = [...src("../lib/data/games.ts").matchAll(/^\s*id: "([a-z-]+)",/gm)].map((m) => m[1]);
const OVERLAY_KINDS = [...src("../lib/data/overlays.ts").matchAll(/\{ kind: "([a-z-]+)"/g)].map((m) => m[1]);
if (!GAME_IDS.length || !OVERLAY_KINDS.length) {
  console.error("✗ could not read the game/overlay lists — the check would cover less than it says");
  process.exit(1);
}

const routes = [
  { path: "/", name: "home" },
  { path: "/discover", name: "discover" },
  { path: "/games", name: "games catalog" },
  { path: "/create", name: "create" },
  { path: "/docs", name: "docs" },
  { path: "/wallet-guide", name: "wallet guide" },
  { path: "/me", name: "me" },
  { path: "/space", name: "space (cabinet)" },
  { path: `/@${HANDLE}`, name: "profile" },
  ...GAME_IDS.map((id) => ({ path: `/@${HANDLE}/${id}`, name: id })),
];

const overlays = OVERLAY_KINDS;

// ──────────────────────────────────────────────────────────────────
// Plumbing
// ──────────────────────────────────────────────────────────────────

/** A page that remembers everything the browser complained about. */
async function open(browser, { width = 1280, height = 900 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (IGNORED_CONSOLE.some((re) => re.test(t))) return;
    errors.push(`console: ${t}`);
  });
  page.on("requestfailed", (r) => {
    const u = r.url();
    // A navigation cancels whatever the previous page had in flight — Next's
    // prefetch of a route the visitor just left is *supposed* to be aborted, and
    // counting it made "click Back" look like a broken page.
    const why = r.failure()?.errorText || "";
    if (/ERR_ABORTED/i.test(why)) return;
    if (u.startsWith(BASE) && !/favicon/.test(u)) errors.push(`request failed: ${u} (${why})`);
  });
  return { ctx, page, errors };
}

/**
 * Load a route and wait until it has actually drawn.
 *
 * Not a flat sleep: these pages poll (so `networkidle` never fires) and a dev
 * server compiles each route on its first hit, which took seconds and made the
 * first check of a page read an empty body. Waiting for content instead of for
 * a number of milliseconds is also what the check is really about.
 */
async function goto(page, path, settle = 900) {
  // Generous and retried once: a dev server compiling a route under a browser
  // that is already hammering it can miss 30s, and a suite that dies on one slow
  // navigation reports nothing about the other hundred checks. A page that
  // genuinely never loads still fails — as a check, not as a stack trace.
  page.setDefaultNavigationTimeout(60_000);
  let res = null;
  for (let attempt = 0; attempt < 2 && !res; attempt++) {
    res = await page.goto(BASE + path, { waitUntil: "domcontentloaded" }).catch(() => null);
  }
  await page
    .waitForFunction(() => (document.body?.innerText || "").replace(/\s/g, "").length > 120, null, { timeout: 30_000 })
    .catch(() => {});
  await page.waitForTimeout(settle);
  return res;
}

/**
 * What the page looks like to a person, as one comparable string.
 *
 * Text alone is not enough: picking a preset changes which chip is highlighted
 * and not a single word on the page, and that IS a visible effect. So the
 * snapshot carries the state a person can see — classes, pressed/selected
 * states, field values, focus and scroll — alongside the words.
 */
const snapshot = async (page) => {
  const text = (await page.innerText("body").catch(() => "")).replace(/\s+/g, " ");
  const state = await page
    .evaluate(() => {
      const marks = [...document.querySelectorAll("button, [role='tab'], input, [aria-selected], [aria-expanded]")]
        .map((el) =>
          [
            el.className,
            el.getAttribute("aria-pressed") ?? "",
            el.getAttribute("aria-selected") ?? "",
            el.getAttribute("aria-expanded") ?? "",
            el.value ?? "",
            el.checked ?? "",
          ].join("|")
        )
        .join(";");
      return [marks, Math.round(window.scrollY), document.activeElement?.tagName ?? ""].join("#");
    })
    .catch(() => "");
  return [page.url(), text, state].join(" ~ ");
};

/** Visible, enabled buttons, in document order, with the name a person reads. */
async function controls(page) {
  return page.$$eval("button, [role='tab'], [role='button']", (els) =>
    els
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const st = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none";
      })
      .map((el, i) => ({
        i,
        name: (el.getAttribute("aria-label") || el.innerText || el.title || "").trim().replace(/\s+/g, " "),
        disabled: el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true",
        // Already the chosen one: re-picking the selected sort, tab or preset is
        // allowed to change nothing, because there is nothing to change.
        active:
          /(^|\s|_)active/i.test(el.className || "") ||
          el.getAttribute("aria-pressed") === "true" ||
          el.getAttribute("aria-selected") === "true",
      }))
  );
}

// ──────────────────────────────────────────────────────────────────
// 1–5: every page, as it stands
// ──────────────────────────────────────────────────────────────────
async function auditPage(browser, route) {
  const { ctx, page, errors } = await open(browser);
  try {
    const res = await goto(page, route.path);
    const status = res?.status() ?? 0;
    check(`${route.name}: loads (${status || "no answer"})`, status > 0 && status < 400, `HTTP ${status || "timeout"}`);
    if (!status || status >= 400) return;

    const text = await page.innerText("body");
    check(`${route.name}: renders something to read`, text.replace(/\s/g, "").length > 120, `${text.length} chars`);

    // A heading is how a person knows where they are. Exactly one h1 per page.
    const h1s = await page.$$eval("h1", (els) => els.map((e) => e.innerText.trim()).filter(Boolean));
    check(`${route.name}: has exactly one page heading`, h1s.length === 1, `h1s: ${JSON.stringify(h1s)}`);

    // Every control a person can click must say what it is.
    const ctrls = await controls(page);
    const nameless = ctrls.filter((c) => !c.name);
    check(`${route.name}: every control has a readable name`, nameless.length === 0, `${nameless.length} unnamed`);

    // Every field must say what it wants before it is typed into.
    const mute = await page.$$eval("input:not([type=hidden]), textarea", (els) =>
      els
        .filter((el) => el.getBoundingClientRect().width > 0)
        .filter(
          (el) =>
            !el.getAttribute("placeholder") &&
            !el.getAttribute("aria-label") &&
            !(el.labels && el.labels.length) &&
            el.type !== "checkbox" &&
            el.type !== "radio" &&
            el.type !== "range"
        )
        .map((el) => el.outerHTML.slice(0, 80))
    );
    check(`${route.name}: every field says what it wants`, mute.length === 0, mute.join(" | "));

    // A dead primary button with no reason beside it is the worst state a page
    // can be in: the visitor is stuck and not told why.
    const stuck = await page.$$eval("button.btn[disabled], button[disabled].btn", (els) =>
      els
        .filter((el) => el.getBoundingClientRect().width > 0)
        .filter((el) => {
          const card = el.closest("div");
          const near = (card?.innerText || "").replace(el.innerText || "", "");
          return near.replace(/\s/g, "").length < 20;
        })
        .map((el) => (el.innerText || "").trim())
    );
    check(`${route.name}: a disabled call-to-action is explained`, stuck.length === 0, stuck.join(" | "));

    check(`${route.name}: nothing threw`, errors.length === 0, errors.slice(0, 3).join(" ⏎ "));
  } finally {
    await ctx.close();
  }
}

/** The same page on a phone: nothing may hang off the side of the screen. */
async function auditMobile(browser, route) {
  const { ctx, page } = await open(browser, { width: 390, height: 844 });
  try {
    const res = await goto(page, route.path, 1200);
    if ((res?.status() ?? 0) >= 400) return;
    const over = await page.evaluate(() => {
      const d = document.documentElement;
      const wide = [...document.querySelectorAll("body *")]
        .filter((el) => el.getBoundingClientRect().right > d.clientWidth + 2)
        .slice(0, 3)
        .map((el) => `${el.tagName.toLowerCase()}.${(el.className || "").toString().split(" ")[0]}`);
      return { scroll: d.scrollWidth, client: d.clientWidth, wide };
    });
    check(
      `${route.name} @390px: no horizontal scroll`,
      over.scroll <= over.client + 2,
      `${over.scroll} > ${over.client} — ${over.wide.join(", ")}`
    );
  } finally {
    await ctx.close();
  }
}

// ──────────────────────────────────────────────────────────────────
// 3: click everything, one control per fresh load
// ──────────────────────────────────────────────────────────────────
async function clickEverything(browser, route) {
  const { ctx, page } = await open(browser);
  let list;
  try {
    const res = await goto(page, route.path);
    if ((res?.status() ?? 0) >= 400) return;
    list = (await controls(page)).filter((c) => !c.disabled);
  } finally {
    await ctx.close();
  }
  if (!list?.length) return;

  let dead = [];
  let broke = [];
  for (const c of list) {
    const { ctx: c2, page: p2, errors } = await open(browser);
    try {
      await goto(p2, route.path);
      const el = (await p2.$$("button, [role='tab'], [role='button']"))[c.i];
      if (!el) continue;
      const before = await snapshot(p2);
      await el.click({ timeout: 4000 }).catch(() => {});
      await p2.waitForTimeout(900);
      const after = await snapshot(p2);
      const body = await p2.innerText("body").catch(() => "");
      if (body.replace(/\s/g, "").length < 60) broke.push(`${c.name}: blanked the page`);
      if (errors.length) broke.push(`${c.name}: ${errors[0]}`);
      if (before === after && !c.active && !INERT.some((re) => re.test(c.name))) dead.push(c.name);
    } catch (e) {
      broke.push(`${c.name}: ${e}`);
    } finally {
      await c2.close();
    }
  }
  check(`${route.name}: ${list.length} controls clicked, none threw`, broke.length === 0, broke.slice(0, 3).join(" ⏎ "));
  check(`${route.name}: every control does something`, dead.length === 0, `no visible effect: ${dead.join(", ")}`);
}

// ──────────────────────────────────────────────────────────────────
// 6: the flows
// ──────────────────────────────────────────────────────────────────

/** The donation form of a game page, driven the way a viewer drives it. */
async function donateFlow(browser, path, label, { needsText = true } = {}) {
  const { ctx, page, errors } = await open(browser);
  try {
    const res = await goto(page, path, 2500);
    if ((res?.status() ?? 0) >= 400) return skip(`${label}: donate flow`, `HTTP ${res?.status()}`);

    const cta = page.locator("button.btn").filter({ hasText: /\$|back it|send|chip in|contribute|pledge/i }).first();
    if (!(await cta.count())) return skip(`${label}: donate flow`, "no donation button on this page");

    // Nothing typed yet: the button must either be off, or say what it will do.
    const before = await cta.isDisabled();
    if (needsText) {
      const note = (await page.innerText("body")).toLowerCase();
      check(
        `${label}: an empty form explains itself`,
        !before || /name|type|pick|tap|choose|enter/.test(note),
        "disabled with no instruction on the page"
      );
    }

    // Every text field, not the first one: the task form asks for a name and
    // then for the task itself, and filling only the name left the button off —
    // which the check would have reported as the page's fault.
    if (needsText) {
      const fields = page.locator("input[type=text]:visible, textarea:visible");
      for (let i = 0; i < (await fields.count()); i++) await fields.nth(i).fill("UX check").catch(() => {});
    }

    // Presets are the fast path; the custom field is the escape hatch. Both must work.
    const chips = page.locator(".chip, [class*=chip]");
    const n = await chips.count();
    if (n > 0) {
      await chips.nth(Math.min(1, n - 1)).click().catch(() => {});
      await page.waitForTimeout(300);
      const active = await page.locator("[class*=active]").count();
      check(`${label}: picking a preset shows which one is picked`, active > 0, "no active state after clicking a chip");
    }

    const custom = page.locator("input[type=number]").first();
    if (await custom.count()) {
      await custom.fill("7");
      await page.waitForTimeout(300);
      const t = (await cta.innerText()).toLowerCase();
      check(`${label}: a custom amount reaches the button`, /7/.test(t), `button says "${t}"`);
    }

    check(`${label}: the form's button is live once it is filled in`, !(await cta.isDisabled()), "still disabled");

    // The confirmation is the last thing between a viewer and their money: it
    // must appear, and backing out of it must be possible.
    await cta.click().catch(() => {});
    await page.waitForTimeout(900);
    const body = await page.innerText("body");
    const confirmed = /confirm|cancel|are you sure|no wallet|install/i.test(body);
    check(`${label}: paying asks before it does anything`, confirmed, "no confirmation, no wallet notice");
    const cancel = page.getByRole("button", { name: /cancel|not now|back/i }).first();
    if (await cancel.count()) {
      await cancel.click().catch(() => {});
      await page.waitForTimeout(600);
      check(`${label}: backing out of the confirmation returns to the form`, await cta.count(), "form gone after cancel");
    }
    check(`${label}: donate flow threw nothing`, errors.length === 0, errors.slice(0, 2).join(" ⏎ "));
  } finally {
    await ctx.close();
  }
}

/** Tabs are the main navigation of every game page: each one must show its own thing. */
async function tabsFlow(browser, path, label) {
  const { ctx, page } = await open(browser);
  try {
    const res = await goto(page, path, 2500);
    if ((res?.status() ?? 0) >= 400) return skip(`${label}: tabs`, `HTTP ${res?.status()}`);
    const tabs = page.locator("button").filter({ hasText: /^(back a |the wheel|rules|about|updates|backers|history)/i });
    const n = await tabs.count();
    if (!n) return skip(`${label}: tabs`, "no tabs on this page");
    const seen = new Set();
    for (let i = 0; i < n; i++) {
      await tabs.nth(i).click().catch(() => {});
      await page.waitForTimeout(700);
      seen.add((await page.innerText("body")).replace(/\s+/g, " ").slice(0, 4000));
    }
    check(`${label}: each of the ${n} tabs shows something different`, seen.size === n, `${seen.size} distinct views`);
  } finally {
    await ctx.close();
  }
}

async function discoverFlow(browser) {
  const { ctx, page } = await open(browser);
  try {
    await goto(page, "/discover", 2000);
    const search = page.locator("input").first();
    if (!(await search.count())) return skip("discover: search", "no search field");
    const before = await page.innerText("body");
    await search.fill("zzzznotathing");
    // The catalog plays an exit cascade (~700ms) before it swaps the results in,
    // so anything shorter than that reads the list it had a moment ago.
    await page.waitForTimeout(2000);
    const after = await page.innerText("body");
    check("discover: a search with no matches says so", before !== after, "the list did not react");
    await search.fill("");
    await page.waitForTimeout(2000);
    check("discover: clearing the search brings the list back", (await page.innerText("body")).length > 200, "list stayed empty");
  } finally {
    await ctx.close();
  }
}

async function catalogFlow(browser) {
  const { ctx, page } = await open(browser);
  try {
    await goto(page, "/games", 1500);
    const cards = page.locator("a[href^='/games/']");
    const n = await cards.count();
    check("games: the catalog lists games", n > 0, `${n} cards`);
    for (let i = 0; i < Math.min(n, 8); i++) {
      const href = await cards.nth(i).getAttribute("href");
      const r = await page.goto(BASE + href, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(600);
      const ok = (r?.status() ?? 0) < 400 && (await page.$$eval("h1", (e) => e.length)) === 1;
      check(`games: ${href} opens with a heading`, ok, `HTTP ${r?.status()}`);
      await page.goBack({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(400);
    }
  } finally {
    await ctx.close();
  }
}

async function overlayFlow(browser) {
  for (const w of overlays) {
    const { ctx, page, errors } = await open(browser, { width: 1920, height: 1080 });
    try {
      const r = await goto(page, `/overlay/${HANDLE}/${w}?demo=1`, 2000);
      if ((r?.status() ?? 0) >= 400) {
        skip(`overlay ${w}`, `HTTP ${r?.status()}`);
        continue;
      }
      const a = await page.innerText("body");
      check(`overlay ${w}: draws something`, a.replace(/\s/g, "").length > 0, "blank overlay");

      // Waited for, not sampled once: the demo cadences differ by widget on
      // purpose — the record widget escalates every ~30s so its coronation is
      // demonstrable — and a fixed 4s window called the slow ones frozen.
      let moved = false;
      for (let i = 0; i < 74 && !moved; i++) {
        await page.waitForTimeout(500);
        moved = (await page.innerText("body")) !== a;
      }
      check(`overlay ${w}: the demo actually moves`, moved, "identical after 37s");
      check(`overlay ${w}: threw nothing`, errors.length === 0, errors.slice(0, 2).join(" ⏎ "));
    } finally {
      await ctx.close();
    }
  }
}

/**
 * `/@handle/<slug>` — the campaign route.
 *
 * It has no data source any more (`campaigns` is a frozen empty object in the
 * provider), so every slug lands on its not-found state. That is fine, and this
 * check exists so it stays a proper page with a way out rather than quietly
 * becoming a blank one.
 */
async function campaignRouteFlow(browser) {
  const { ctx, page } = await open(browser);
  try {
    await goto(page, `/@${HANDLE}/some-campaign`, 1200);
    const body = await page.innerText("body");
    check("campaign route: says there is nothing there", /not found|no such|nothing/i.test(body), body.slice(0, 80));
    const out = await page.locator("a, button").filter({ hasText: /back|home|discover|profile|cheer/i }).count();
    check("campaign route: offers a way out", out > 0, "dead end");
  } finally {
    await ctx.close();
  }
}

async function missingPageFlow(browser) {
  const { ctx, page } = await open(browser);
  try {
    await goto(page, "/@nobody-lives-here-ux", 1200);
    const body = await page.innerText("body");
    check("a page that does not exist says so", /no such|not found|nothing here|404/i.test(body), body.slice(0, 80));
    const out = await page.locator("a, button").filter({ hasText: /back|home|discover|browse|cheer/i }).count();
    check("a page that does not exist offers a way out", out > 0, "dead end");
  } finally {
    await ctx.close();
  }
}


/**
 * Every internal link on every page, followed.
 *
 * A link that 404s is the cheapest possible way to lose a visitor, and the only
 * way to find one is to follow it. Checked with plain requests rather than the
 * browser: the question is whether the route exists, not how it looks.
 */
async function linkSweep(browser) {
  const seen = new Map(); // href → where it was found
  for (const r of routes) {
    const { ctx, page } = await open(browser);
    try {
      const res = await goto(page, r.path, 500);
      if ((res?.status() ?? 0) >= 400) continue;
      const hrefs = await page.$$eval("a[href]", (els) => els.map((e) => e.getAttribute("href")));
      for (const h of hrefs) {
        if (!h || h.startsWith("#") || h.startsWith("mailto:") || h.startsWith("http")) continue;
        if (!seen.has(h)) seen.set(h, r.name);
      }
    } finally {
      await ctx.close();
    }
  }
  const broken = [];
  for (const [href, where] of seen) {
    const res = await fetch(BASE + href, { redirect: "follow" }).catch(() => null);
    if (!res || res.status >= 400) broken.push(`${href} (on ${where}) → ${res?.status ?? "no answer"}`);
  }
  check(`${seen.size} internal links, all of them resolve`, broken.length === 0, broken.slice(0, 5).join(" ⏎ "));
}

/**
 * The cabinet without a wallet.
 *
 * Everything behind it needs a signature, so the only thing that matters here is
 * that it SAYS so and offers the way in — a maker who lands on an empty page
 * with no explanation has no idea whether the app is broken or they are.
 */
async function cabinetGateFlow(browser) {
  const { ctx, page } = await open(browser);
  try {
    await goto(page, "/space", 2000);
    const body = await page.innerText("body");
    check("cabinet: says a wallet is what it needs", /wallet|connect|sign/i.test(body), body.slice(0, 100));
    const connect = page.locator("button, a").filter({ hasText: /connect|wallet/i }).first();
    check("cabinet: offers the way in", await connect.count(), "no connect control");
  } finally {
    await ctx.close();
  }
}

/**
 * The donation form, from the keyboard alone.
 *
 * A form that only works with a mouse is a form half the people cannot use, and
 * nothing else in this suite would notice: every other check clicks.
 */
async function keyboardFlow(browser, path, label) {
  const { ctx, page } = await open(browser);
  try {
    const res = await goto(page, path, 2000);
    if ((res?.status() ?? 0) >= 400) return skip(`${label}: keyboard`, `HTTP ${res?.status()}`);
    const first = page.locator("input:visible:not([type=hidden]), textarea:visible").first();
    if (!(await first.count())) return skip(`${label}: keyboard`, "no field to type into");
    await first.focus();

    // Tab through the form the way a person does, filling what asks to be
    // filled on the way: the task form wants a name AND the task itself, and
    // typing only into the first field leaves the button off — which is correct
    // behaviour, and would look like an unreachable button to a lazier check.
    let typed = 0;
    let reached = false;
    for (let i = 0; i < 40 && !reached; i++) {
      const kind = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el) return "none";
        if (el.tagName === "BUTTON" && /btn/.test(el.className) && !el.disabled) return "cta";
        if ((el.tagName === "INPUT" || el.tagName === "TEXTAREA") && !el.value && el.type !== "checkbox") {
          return el.type === "number" ? "number" : "text";
        }
        return "other";
      });
      if (kind === "cta") {
        reached = true;
        break;
      }
      if (kind === "text" || kind === "number") {
        await page.keyboard.type(kind === "number" ? "12" : "Keyboard check");
        typed++;
      }
      await page.keyboard.press("Tab");
    }
    check(`${label}: the fields take typing`, typed > 0, "nothing could be typed into");
    check(`${label}: the primary button is reachable by Tab`, reached, "never focused within 40 tabs");
    if (!reached) return;
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1200);
    const body = await page.innerText("body");
    check(
      `${label}: Enter on it does what a click does`,
      /confirm|cancel|are you sure|no wallet|install/i.test(body),
      "nothing happened"
    );
  } finally {
    await ctx.close();
  }
}

/**
 * The public proof page of a chain round, when there is one to check.
 *
 * Loud when it cannot run: the page exists precisely for the moment someone
 * doubts a result, and "we never opened it" is not something to discover later.
 */
async function verifyPageFlow(browser) {
  const r = await fetch(`${BASE}/api/roulette/round?handle=${HANDLE}`).then((x) => x.json()).catch(() => null);
  const round = r?.rounds?.[0];
  if (!round) return skip("roulette verify page", `no chain round on @${HANDLE}`);
  const { ctx, page, errors } = await open(browser);
  try {
    await goto(page, `/@${HANDLE}/roulette/verify/${round.roundHex}`, 3000);
    // The page reads the chain itself, which is slower than a render.
    await page
      .waitForFunction(() => /✓|✗/.test(document.body.innerText), null, { timeout: 60_000 })
      .catch(() => {});
    const body = await page.innerText("body");
    check("roulette verify page: states its checks", (body.match(/✓/g) || []).length >= 2, body.slice(0, 120));
    check("roulette verify page: threw nothing", errors.length === 0, errors.slice(0, 2).join(" ⏎ "));
  } finally {
    await ctx.close();
  }
}

// ──────────────────────────────────────────────────────────────────
const t0 = Date.now();
console.log(`UI check against ${BASE} (@${HANDLE})\n`);

const health = await fetch(`${BASE}/api/health`).catch(() => null);
if (!health?.ok) {
  console.error(`✗ no server at ${BASE} — start it with "npm run dev" first`);
  process.exit(1);
}

// A dev server compiles each route on its first request, and that first request
// is otherwise a check — one that measures the compiler, not the page. Warm them
// all up first, in parallel, and then start looking.
await Promise.all(
  [...routes.map((r) => r.path), ...overlays.map((k) => `/overlay/${HANDLE}/${k}?demo=1`)].map((p) =>
    fetch(BASE + p).catch(() => null)
  )
);

const browser = await chromium.launch();
try {
  console.log("— every page, as it stands —");
  for (const r of routes) await auditPage(browser, r);

  console.log("\n— on a phone —");
  for (const r of routes) await auditMobile(browser, r);

  console.log("\n— every control, clicked —");
  for (const r of routes) await clickEverything(browser, r);

  console.log("\n— the flows —");
  await tabsFlow(browser, `/@${HANDLE}/roulette`, "roulette");
  await tabsFlow(browser, `/@${HANDLE}/task`, "task");
  await tabsFlow(browser, `/@${HANDLE}/fundraiser`, "fundraiser");
  await donateFlow(browser, `/@${HANDLE}/roulette`, "roulette");
  await donateFlow(browser, `/@${HANDLE}/task`, "task");
  await donateFlow(browser, `/@${HANDLE}/fundraiser`, "fundraiser", { needsText: false });
  await discoverFlow(browser);
  await catalogFlow(browser);
  await overlayFlow(browser);
  await missingPageFlow(browser);
  await campaignRouteFlow(browser);
  await cabinetGateFlow(browser);
  for (const id of GAME_IDS) await keyboardFlow(browser, `/@${HANDLE}/${id}`, id);
  await verifyPageFlow(browser);

  console.log("\n— every link —");
  await linkSweep(browser);
} finally {
  await browser.close();
}

const secs = ((Date.now() - t0) / 1000).toFixed(0);
console.log(
  `\n${failed ? `✗ ${failed} ПРОВЕРОК УПАЛО` : "ВСЕ ПРОВЕРКИ ПРОШЛИ"}${skipped ? ` (${skipped} пропущено)` : ""} — ${secs}s`
);
process.exit(failed ? 1 : 0);
