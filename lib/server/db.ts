import { createClient, type Client } from "@libsql/client";
import path from "path";
import fs from "fs";

// ──────────────────────────────────────────────────────────────────
// The Crown database: one SQLite file, embedded in the app (libsql —
// prebuilt binaries, no compile step, the .db is a plain SQLite file any
// tool can open). This is the "crown-app server" side of the plan: the
// mirror of on-chain money (feed, reputation) plus everything the chain
// deliberately does NOT store — profiles, game texts (canisters keep
// hashes only), telegram links, notifications.
//
// Money rule: rows in `donations` come ONLY from the indexer reading
// finalized Settled events off the splitter — the API can attach a
// message/name to a signature (intent), never invent a donation.
// ──────────────────────────────────────────────────────────────────

const DB_DIR = process.env.CROWN_DB_DIR || path.join(process.cwd(), "data");
const DB_FILE = path.join(DB_DIR, "crown.db");

// Schema versions, applied in order inside one transaction each. Append-only:
// released versions never change — add v2, v3… for future shape changes.
const MIGRATIONS: string[][] = [
  [
    `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,

    // Streamer pages. `data` carries the full Profile JSON (socials, tiers,
    // page-builder drafts, game configs) — the app's own shape, no lossy
    // column mapping; hot fields are lifted out for indexing/joins.
    `CREATE TABLE IF NOT EXISTS profiles (
      handle TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT NOT NULL DEFAULT '',
      data TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_profiles_address ON profiles(address)`,

    // The mirror of the splitter's Settled events (the open book, our copy).
    // payer — the wallet the book credits (escrow re-attributed to its donor
    // when the escrow account is still readable); raw_payer — as emitted.
    `CREATE TABLE IF NOT EXISTS donations (
      signature TEXT PRIMARY KEY,
      slot INTEGER NOT NULL,
      block_time INTEGER,
      payer TEXT NOT NULL,
      raw_payer TEXT NOT NULL,
      streamer TEXT NOT NULL,
      gross INTEGER NOT NULL,
      source TEXT NOT NULL DEFAULT 'direct',
      donor_name TEXT,
      message TEXT,
      created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_don_streamer_time ON donations(streamer, block_time DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_don_payer ON donations(payer)`,

    // A donor's own words for a tx they just sent: matched to the Settled row
    // by signature when the indexer ingests it. Client-supplied, so it can
    // only DECORATE a donation, never create one.
    `CREATE TABLE IF NOT EXISTS donation_intents (
      signature TEXT PRIMARY KEY,
      handle TEXT NOT NULL,
      donor_name TEXT,
      message TEXT,
      source TEXT NOT NULL DEFAULT 'direct',
      created_at INTEGER NOT NULL
    )`,

    // Folded (payer, streamer) → Σ gross, maintained transactionally with
    // donation inserts. Same semantics as crown-index's book; the canister
    // stays the authority when it ships — this mirror answers instantly.
    `CREATE TABLE IF NOT EXISTS reputation (
      payer TEXT NOT NULL,
      streamer TEXT NOT NULL,
      total INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (payer, streamer)
    )`,

    // Game texts — the words the canisters refuse to hold (they store hashes).
    `CREATE TABLE IF NOT EXISTS game_texts (
      id TEXT PRIMARY KEY,
      game TEXT NOT NULL,
      handle TEXT NOT NULL,
      escrow TEXT,
      body TEXT NOT NULL,
      salt TEXT,
      created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_texts_handle ON game_texts(handle, game)`,

    // Telegram bot state — was bot/data/store.json; same shapes, real rows.
    `CREATE TABLE IF NOT EXISTS tg_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS tg_pending (
      code TEXT PRIMARY KEY,
      handle TEXT NOT NULL,
      name TEXT NOT NULL,
      at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS tg_links (
      handle TEXT PRIMARY KEY,
      chat_id INTEGER NOT NULL,
      tg_name TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      categories TEXT NOT NULL DEFAULT '{}',
      monthly INTEGER NOT NULL DEFAULT 0,
      at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS tg_founders (chat_id INTEGER PRIMARY KEY)`,
    `CREATE TABLE IF NOT EXISTS tg_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      caption TEXT NOT NULL,
      card TEXT,
      buttons TEXT,
      created_at INTEGER NOT NULL
    )`,

    // The cabinet bell.
    `CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      handle TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      read INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_notif_handle ON notifications(handle, created_at DESC)`,
  ],
  // v2 — page ownership for signed mutations: the wallet that created a page
  // is its owner; only its signature may update or delete the page. '' marks
  // demo pages (created without a wallet) — writable unsigned, but a demo
  // write can never touch an owned page.
  [`ALTER TABLE profiles ADD COLUMN owner TEXT NOT NULL DEFAULT ''`],
  // v3 — shared game state: the server copy of the per-scope keys the mini-games
  // used to keep only in each browser's localStorage (task queue, roulette round,
  // auction lots, fundraiser total). One row per (scope, k); v is the same JSON
  // the client stores locally, so the sync layer adopts it verbatim.
  [
    `CREATE TABLE IF NOT EXISTS game_state (
      scope TEXT NOT NULL,
      k TEXT NOT NULL,
      v TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (scope, k)
    )`,
  ],
  // v4 — reliable Telegram delivery. The outbox used to be drained destructively: the bot GET
  // cleared the table before anything was actually sent, so a crash or a Telegram 429 lost those
  // notifications for good. Rows now carry delivery state, so a message leaves the queue only once
  // the bot confirms Telegram accepted it (see /api/telegram/outbox + /outbox/ack).
  [
    `ALTER TABLE tg_outbox ADD COLUMN claimed_at INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE tg_outbox ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE tg_outbox ADD COLUMN next_try_at INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE tg_outbox ADD COLUMN last_error TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_tg_outbox_due ON tg_outbox(next_try_at, claimed_at)`,
    // The bot's own cursor + heartbeat live here (getUpdates offset, last-seen), so a restart
    // doesn't replay a day of updates and the cabinet can tell whether the bot is actually alive.
    `CREATE TABLE IF NOT EXISTS tg_bot_state (
      k TEXT PRIMARY KEY,
      v TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
  ],
];

let client: Client | null = null;
let migrated: Promise<void> | null = null;

function connect(): Client {
  if (!client) {
    // Serverless-friendly escape hatch: point LIBSQL_URL at a Turso/libsql
    // server and the same code runs without a writable disk. Default is the
    // local file — one process, zero infra.
    const remote = process.env.LIBSQL_URL;
    if (remote) {
      client = createClient({ url: remote, authToken: process.env.LIBSQL_AUTH_TOKEN });
    } else {
      fs.mkdirSync(DB_DIR, { recursive: true });
      client = createClient({ url: `file:${DB_FILE}` });
    }
  }
  return client;
}

// Online backup (safe while writes are in flight): SQLite's VACUUM INTO
// writes a consistent snapshot. No-op on remote (Turso backs itself up).
export async function backupTo(destPath: string): Promise<boolean> {
  if (process.env.LIBSQL_URL) return false;
  const c = await db();
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  await c.execute(`VACUUM INTO '${destPath.replace(/'/g, "''")}'`);
  return true;
}

async function migrate(c: Client): Promise<void> {
  await c.execute(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  const row = await c.execute(`SELECT value FROM meta WHERE key = 'schema_version'`);
  const current = row.rows.length ? Number(row.rows[0].value) : 0;
  for (let v = current; v < MIGRATIONS.length; v++) {
    const tx = await c.transaction("write");
    try {
      for (const sql of MIGRATIONS[v]) await tx.execute(sql);
      await tx.execute({
        sql: `INSERT INTO meta (key, value) VALUES ('schema_version', ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        args: [String(v + 1)],
      });
      await tx.commit();
    } catch (e) {
      await tx.rollback();
      throw e;
    }
  }
}

// The one entry point: a connected, fully-migrated client.
export async function db(): Promise<Client> {
  const c = connect();
  if (!migrated) migrated = migrate(c);
  await migrated;
  return c;
}

export const now = () => Math.floor(Date.now() / 1000);
