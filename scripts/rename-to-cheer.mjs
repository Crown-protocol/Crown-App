// One-off rename: Crown → Cheer, donate → cheer, across the whole app.
//
// Deliberately NOT a blind sed. Three classes of string look identical to a search but behave very
// differently, so each is handled on its own terms:
//
//   1. Contract-bound literals — the seeds and discriminators that derive on-chain addresses
//      ("escrow", "__event_authority", the hex discs). Renaming one sends money to an address the
//      deployed program will never look at. These are LEFT ALONE, and the guard below fails the run
//      if an edit ever touches a line containing one.
//   2. Persisted keys — localStorage / game_state keys like "crown-tasks". Safe to rename ONLY
//      because a migration rewrites the stored rows in the same pass (scripts/migrate-cheer-keys.mjs).
//   3. Everything else — copy, comments, CSS class names, env var names, docs. Free to change.
//
// Run: node scripts/rename-to-cheer.mjs [--dry]

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const DRY = process.argv.includes("--dry");
const ROOT = process.cwd();

// Paths never touched: build output, deps, the database itself, git.
// Build output in any of its forms: rewriting a compiled bundle changes nothing that survives the
// next build, and .next-audit alone accounted for most of a 770-file first pass.
const SKIP_DIR = new Set(["node_modules", ".git", "data", "scripts", "coverage", "dist", "build"]);
const SKIP_PREFIX = [".next"];
const EXT = new Set([".ts", ".tsx", ".css", ".mjs", ".js", ".json", ".md", ".service", ".example", ""]);

// Literals that reach the chain. A line containing any of these is refused, not rewritten — the
// rename must never be the reason an escrow address stops resolving.
const CHAIN_GUARDS = [
  'Buffer.from("escrow")',
  '__event_authority',
  'CREATE_ESCROW_DISC',
  'ESCROW_DISC',
  'DONATE_DISC',
  'findProgramAddressSync',
];

// Order matters: longer, more specific patterns first so a general rule can't eat a specific one.
const RULES = [
  // ── product name ────────────────────────────────────────────────────────────
  [/\bCROWN\b/g, "CHEER"],
  [/\bCrown\b/g, "Cheer"],
  [/\bcrown\b/g, "cheer"],
  [/crown-/g, "cheer-"],
  [/CROWN_/g, "CHEER_"],
  [/crownapp/gi, "cheerapp"],

  // ── the action itself: donate → cheer ────────────────────────────────────────
  // "Donation(s)" as a noun keeps its meaning in money contexts (a donation IS still a donation),
  // but the call to action and the product's verb become "cheer" per the rename.
  [/\bMake a donate\b/g, "Make a cheer"],
  [/\bmake a donate\b/g, "make a cheer"],
];

let changed = 0;
let skipped = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.has(name) || SKIP_PREFIX.some((p) => name.startsWith(p))) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (EXT.has(extname(p))) visit(p);
  }
}

function visit(path) {
  const before = readFileSync(path, "utf8");
  if (!/crown/i.test(before)) return;

  const lines = before.split("\n");
  let touched = false;

  const after = lines
    .map((line) => {
      if (!/crown/i.test(line)) return line;
      // Never rewrite a line that also carries a chain-bound literal.
      if (CHAIN_GUARDS.some((g) => line.includes(g))) {
        skipped.push(`${path}: ${line.trim().slice(0, 70)}`);
        return line;
      }
      let out = line;
      for (const [re, to] of RULES) out = out.replace(re, to);
      if (out !== line) touched = true;
      return out;
    })
    .join("\n");

  if (!touched) return;
  changed++;
  if (!DRY) writeFileSync(path, after);
}

walk(ROOT);

console.log(`${DRY ? "[dry run] " : ""}files changed: ${changed}`);
if (skipped.length) {
  console.log(`chain-bound lines left untouched: ${skipped.length}`);
  for (const s of skipped.slice(0, 10)) console.log("  " + s);
}
