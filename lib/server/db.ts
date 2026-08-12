import { createClient, type Client } from "@libsql/client";
import path from "path";
import fs from "fs";

// ──────────────────────────────────────────────────────────────────
// The Cheer database: one SQLite file, embedded in the app (libsql —
// prebuilt binaries, no compile step, the .db is a plain SQLite file any
// tool can open). This is the "cheer-app server" side of the plan: the
// mirror of on-chain money (feed, reputation) plus everything the chain
// deliberately does NOT store — profiles, game texts (canisters keep
// hashes only), telegram links, notifications.
//
// Money rule: rows in `donations` come ONLY from the indexer reading
// finalized Settled events off the splitter — the API can attach a
// message/name to a signature (intent), never invent a donation.
// ──────────────────────────────────────────────────────────────────

const DB_DIR = process.env.CHEER_DB_DIR || path.join(process.cwd(), "data");
const DB_FILE = path.join(DB_DIR, "cheer.db");

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
    // Keyed per Settled EVENT, not per transaction: one tx can pay several recipients, and each
    // payment is its own donation. See the v5 migration for the history.
    `CREATE TABLE IF NOT EXISTS donations (
      signature TEXT NOT NULL,
      ev_index INTEGER NOT NULL DEFAULT 0,
      slot INTEGER NOT NULL,
      block_time INTEGER,
      payer TEXT NOT NULL,
      raw_payer TEXT NOT NULL,
      streamer TEXT NOT NULL,
      gross INTEGER NOT NULL,
      source TEXT NOT NULL DEFAULT 'direct',
      donor_name TEXT,
      message TEXT,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (signature, ev_index)
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
    // donation inserts. Same semantics as cheer-index's book; the canister
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
  // task queue, fundraiser total). One row per (scope, k); v is the same JSON
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
  // v5 — one donation row per Settled EVENT, not per transaction. The splitter can emit several
  // Settled events in a single tx (paying more than one recipient); with `signature` as the whole
  // primary key, insertDonation saw the signature already stored and silently dropped every event
  // after the first — those streamers lost both the donation and the reputation. The key is now
  // (signature, ev_index), so each event is its own row and re-scanning a signature stays
  // idempotent. SQLite cannot alter a primary key in place, hence the rebuild-and-copy; rows that
  // already exist become ev_index 0, which is what they always were.
  [
    `CREATE TABLE donations_v5 (
      signature TEXT NOT NULL,
      ev_index INTEGER NOT NULL DEFAULT 0,
      slot INTEGER NOT NULL,
      block_time INTEGER,
      payer TEXT NOT NULL,
      raw_payer TEXT NOT NULL,
      streamer TEXT NOT NULL,
      gross INTEGER NOT NULL,
      source TEXT NOT NULL DEFAULT 'direct',
      donor_name TEXT,
      message TEXT,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (signature, ev_index)
    )`,
    `INSERT INTO donations_v5 (signature, ev_index, slot, block_time, payer, raw_payer, streamer, gross, source, donor_name, message, created_at)
       SELECT signature, 0, slot, block_time, payer, raw_payer, streamer, gross, source, donor_name, message, created_at FROM donations`,
    `DROP TABLE donations`,
    `ALTER TABLE donations_v5 RENAME TO donations`,
    `CREATE INDEX IF NOT EXISTS idx_don_streamer_time ON donations(streamer, block_time DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_don_payer ON donations(payer)`,
  ],
  // v6 — one-time sign-in signatures. A sign-in signature is only fresh for AUTH_WINDOW_SECONDS, but
  // within that window it could be replayed to mint extra sessions. We record the base64 signature of
  // each consumed login the moment it mints a session; a second POST with the same bytes is rejected.
  // `expires_at` (seconds) lets a sweep drop rows once they're stale — a signature past its freshness
  // window can't be replayed anyway, so the table stays tiny.
  [
    `CREATE TABLE IF NOT EXISTS consumed_sigs (
      sig TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_consumed_expires ON consumed_sigs(expires_at)`,
  ],
  // v7 — the submitter's ledger of paid ingests (`crown-spec/docs/07-build-plan.md
  // §Контракт подающего впись`). One row per Solana signature we have paid, or
  // tried to pay, the index to fold.
  //
  // It exists for one reason: the index deliberately keeps NO attempt budget (a
  // self-limit there would let anyone poison someone else's signature), so the
  // only thing that can stop us paying for a read that will never succeed is our
  // own count — and a count that lives in memory resets on every deploy, which
  // is the same as not having one. `attempts` is that ceiling; `status` is why we
  // stopped.
  [
    `CREATE TABLE IF NOT EXISTS ingest_jobs (
      signature TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      escrow TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      last_result TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_ingest_status ON ingest_jobs(status, updated_at)`,
  ],
  // v8 — a recipient's signed `create` for a collection, held until it can be
  // spent. conditional-funding creates lazily: `create_collection` is signed by
  // the RECIPIENT but demands the birth proof of the FIRST contribution, which
  // only exists once a donor has funded one. Without somewhere to keep the
  // signed message in between, opening a collection would mean asking the
  // recipient to be present at the moment a stranger chips in.
  //
  // The row holds only what the recipient already signed in public plus the
  // fields the id commits — no secret, and it authorizes exactly one message.
  [
    `CREATE TABLE IF NOT EXISTS collection_intents (
      collection_hex TEXT PRIMARY KEY,
      recipient TEXT NOT NULL,
      recipient_nonce TEXT NOT NULL,
      duration INTEGER NOT NULL,
      goal TEXT NOT NULL,
      signed_message TEXT NOT NULL,
      pubkey TEXT NOT NULL,
      signature TEXT NOT NULL,
      materialized_at INTEGER,
      created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_collection_recipient ON collection_intents(recipient)`,
  ],
  // v9 — the roulette: a round is a signed announcement, and the titles behind
  // the slices.
  //
  // Neither table is an authority, and that is the point of the game. The round
  // row holds the canonical announcement bytes plus the recipient's signature
  // over them, so anyone can re-verify it without us; `round_hex` is their hash,
  // so a row that disagrees with its own id cannot be stored. The entry row holds
  // a title, and `entry_hex` is its hash under the round — a wrong preimage
  // simply fails to hash, which is why this table needs no signature at all.
  //
  // What we can do is fail to answer. We cannot lie: the wheel is tallied from
  // the chain, and the verdict is computed over keys, never over these words
  // (`crown-games/roulette/docs/spec.md §Тексты`).
  [
    `CREATE TABLE IF NOT EXISTS roulette_rounds (
      round_hex TEXT PRIMARY KEY,
      handle TEXT NOT NULL,
      chain TEXT NOT NULL,
      recipient TEXT NOT NULL,
      announcement TEXT NOT NULL,
      pubkey TEXT NOT NULL,
      signature TEXT NOT NULL,
      open_slot INTEGER NOT NULL,
      close_slot INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_roulette_rounds_handle ON roulette_rounds(handle, close_slot)`,
    `CREATE TABLE IF NOT EXISTS roulette_entries (
      round_hex TEXT NOT NULL,
      entry_hex TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (round_hex, entry_hex)
    )`,
  ],
  // v10 — the maker can hide a title.
  //
  // A column and nothing else, because hiding is a **display** decision and
  // cannot be anything more: the verdict is computed over `entry_hex`, so a
  // hidden slice keeps its key, its pool and its odds and can win while hidden.
  // That is a property of the derivation, not a promise of this table.
  //
  // What it is not is secrecy. `entry_hex = sha256(domain ‖ round ‖ title)`, so
  // whoever wrote the title still has it, and anyone who guesses it can confirm
  // the guess against the chain. This hides a word from our surfaces; it does
  // not unpublish it.
  [`ALTER TABLE roulette_entries ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0`],
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

// Connection settings, applied once before the first query. SQLite's defaults are tuned for a
// single-user desktop file, not for a web server where an API route, the indexer and the telegram
// scheduler all write at the same moment:
//
//   journal_mode=WAL  — readers no longer block behind a writer. Under the default `delete` journal
//                       every page load competed with whatever was mid-write.
//   busy_timeout=5s   — the default is ZERO: a second concurrent write failed instantly with
//                       SQLITE_BUSY, which nothing in the app catches, so it reached the person as a
//                       500. Now a writer waits its turn instead of giving up.
//   synchronous=NORMAL — the safe pairing with WAL: durable across app crashes, and the daily
//                       VACUUM INTO snapshot is what covers the machine-loses-power case.
//   foreign_keys=ON   — enforced rather than assumed.
//
// No-op on remote (Turso manages its own storage).
async function configure(c: Client): Promise<void> {
  if (process.env.LIBSQL_URL) return;
  for (const pragma of ["PRAGMA journal_mode = WAL", "PRAGMA busy_timeout = 5000", "PRAGMA synchronous = NORMAL", "PRAGMA foreign_keys = ON"]) {
    try {
      await c.execute(pragma);
    } catch {
      // A pragma that this build refuses is not worth taking the server down for.
    }
  }
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
  // Settings first, then migrations: the migration itself is a write, and it should run under the
  // same WAL/busy-timeout rules as everything after it. Both are memoised on one promise, so every
  // caller after the first just awaits it.
  if (!migrated) migrated = configure(c).then(() => migrate(c));
  await migrated;
  return c;
}

export const now = () => Math.floor(Date.now() / 1000);
