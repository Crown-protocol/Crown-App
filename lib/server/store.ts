import { db, now } from "./db";
import type { Profile } from "@/lib/data/types";

// ──────────────────────────────────────────────────────────────────
// Domain operations over the Crown DB. Thin, typed, raw-SQL — every
// function is one obvious query, no ORM magic between the app and its data.
// ──────────────────────────────────────────────────────────────────

// ---- profiles ----

// owner — the base58 wallet that may update/delete this page ('' = demo page,
// unsigned writes allowed until a wallet claims it). Set on create/claim,
// never silently changed by an update.
export async function upsertProfile(p: Profile, owner: string): Promise<void> {
  const c = await db();
  await c.execute({
    sql: `INSERT INTO profiles (handle, name, address, data, owner, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(handle) DO UPDATE SET
            name = excluded.name, address = excluded.address,
            data = excluded.data, owner = excluded.owner, updated_at = excluded.updated_at`,
    args: [p.handle.toLowerCase(), p.name, p.address ?? "", JSON.stringify(p), owner, now(), now()],
  });
}

export async function getProfileOwner(handle: string): Promise<string | null> {
  const c = await db();
  const r = await c.execute({ sql: `SELECT owner FROM profiles WHERE handle = ?`, args: [handle.toLowerCase()] });
  return r.rows.length ? String(r.rows[0].owner) : null; // null = no such page
}

export async function getProfile(handle: string): Promise<Profile | null> {
  const c = await db();
  const r = await c.execute({ sql: `SELECT data FROM profiles WHERE handle = ?`, args: [handle.toLowerCase()] });
  return r.rows.length ? (JSON.parse(String(r.rows[0].data)) as Profile) : null;
}

// The account behind a wallet: the page whose OWNER is this wallet — owner is the base58 pubkey that
// signed the registration, i.e. the true login (not the payout address, which a manual page can point
// elsewhere). This is what "does this wallet already have an account?" resolves against at sign-in.
// Newest first, so if a wallet ever owns more than one page the most recently touched wins.
export async function getProfileByOwner(owner: string): Promise<Profile | null> {
  if (!owner) return null;
  const c = await db();
  const r = await c.execute({
    sql: `SELECT data FROM profiles WHERE owner = ? ORDER BY updated_at DESC LIMIT 1`,
    args: [owner],
  });
  return r.rows.length ? (JSON.parse(String(r.rows[0].data)) as Profile) : null;
}

export async function listProfiles(): Promise<Profile[]> {
  const c = await db();
  const r = await c.execute(`SELECT data FROM profiles ORDER BY updated_at DESC LIMIT 500`);
  return r.rows.map((row) => JSON.parse(String(row.data)) as Profile);
}

export async function deleteProfile(handle: string): Promise<void> {
  const c = await db();
  await c.execute({ sql: `DELETE FROM profiles WHERE handle = ?`, args: [handle.toLowerCase()] });
}

// ---- donations (written by the indexer ONLY) + intents ----

export interface DonationRow {
  signature: string;
  slot: number;
  blockTime: number | null;
  payer: string;
  rawPayer: string;
  streamer: string;
  gross: number; // USDC minor units
  source: string;
  donorName: string | null;
  message: string | null;
}

// Insert a Settled event and fold it into the reputation mirror in ONE
// transaction — the two tables can never disagree. Idempotent by signature.
export async function insertDonation(d: DonationRow): Promise<boolean> {
  const c = await db();
  const tx = await c.transaction("write");
  try {
    const dup = await tx.execute({ sql: `SELECT 1 FROM donations WHERE signature = ?`, args: [d.signature] });
    if (dup.rows.length) {
      await tx.rollback();
      return false;
    }
    // A pre-declared intent (donor's name/message for this signature) decorates the row.
    const intent = await tx.execute({ sql: `SELECT donor_name, message, source FROM donation_intents WHERE signature = ?`, args: [d.signature] });
    const donorName = intent.rows.length ? ((intent.rows[0].donor_name as string) ?? d.donorName) : d.donorName;
    const message = intent.rows.length ? ((intent.rows[0].message as string) ?? d.message) : d.message;
    const source = intent.rows.length ? String(intent.rows[0].source) : d.source;

    await tx.execute({
      sql: `INSERT INTO donations (signature, slot, block_time, payer, raw_payer, streamer, gross, source, donor_name, message, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [d.signature, d.slot, d.blockTime, d.payer, d.rawPayer, d.streamer, d.gross, source, donorName, message, now()],
    });
    await tx.execute({
      sql: `INSERT INTO reputation (payer, streamer, total, updated_at) VALUES (?, ?, ?, ?)
            ON CONFLICT(payer, streamer) DO UPDATE SET total = total + excluded.total, updated_at = excluded.updated_at`,
      args: [d.payer, d.streamer, d.gross, now()],
    });
    await tx.commit();
    return true;
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

export async function saveIntent(i: { signature: string; handle: string; donorName?: string; message?: string; source?: string }): Promise<void> {
  const c = await db();
  await c.execute({
    sql: `INSERT INTO donation_intents (signature, handle, donor_name, message, source, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(signature) DO NOTHING`,
    args: [i.signature, i.handle.toLowerCase(), i.donorName ?? null, i.message ?? null, i.source ?? "direct", now()],
  });
  // The tx may already be indexed by the time the intent arrives — decorate in place.
  await c.execute({
    sql: `UPDATE donations SET donor_name = COALESCE(?, donor_name), message = COALESCE(?, message)
          WHERE signature = ? AND donor_name IS NULL AND message IS NULL`,
    args: [i.donorName ?? null, i.message ?? null, i.signature],
  });
}

// Feed for a streamer address (or the global firehose without one).
export async function listDonations(opts: { streamer?: string; limit?: number }): Promise<DonationRow[]> {
  const c = await db();
  const limit = Math.min(Math.max(opts.limit ?? 40, 1), 200);
  const r = opts.streamer
    ? await c.execute({
        sql: `SELECT * FROM donations WHERE streamer = ? ORDER BY COALESCE(block_time, created_at) DESC LIMIT ?`,
        args: [opts.streamer, limit],
      })
    : await c.execute({ sql: `SELECT * FROM donations ORDER BY COALESCE(block_time, created_at) DESC LIMIT ?`, args: [limit] });
  return r.rows.map((row) => ({
    signature: String(row.signature),
    slot: Number(row.slot),
    blockTime: row.block_time === null ? null : Number(row.block_time),
    payer: String(row.payer),
    rawPayer: String(row.raw_payer),
    streamer: String(row.streamer),
    gross: Number(row.gross),
    source: String(row.source),
    donorName: row.donor_name === null ? null : String(row.donor_name),
    message: row.message === null ? null : String(row.message),
  }));
}

// The mirror book: what has this payer honestly sent to each streamer?
export async function reputationOf(payer: string): Promise<{ streamer: string; total: number }[]> {
  const c = await db();
  const r = await c.execute({ sql: `SELECT streamer, total FROM reputation WHERE payer = ?`, args: [payer] });
  return r.rows.map((row) => ({ streamer: String(row.streamer), total: Number(row.total) }));
}

export async function reputationPair(payer: string, streamer: string): Promise<number> {
  const c = await db();
  const r = await c.execute({ sql: `SELECT total FROM reputation WHERE payer = ? AND streamer = ?`, args: [payer, streamer] });
  return r.rows.length ? Number(r.rows[0].total) : 0;
}

// ---- indexer cursor + status ----

export async function getCursor(): Promise<string | null> {
  const c = await db();
  const r = await c.execute(`SELECT value FROM meta WHERE key = 'indexer_cursor'`);
  return r.rows.length ? String(r.rows[0].value) : null;
}

export async function setCursor(sig: string): Promise<void> {
  const c = await db();
  await c.execute({
    sql: `INSERT INTO meta (key, value) VALUES ('indexer_cursor', ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    args: [sig],
  });
}

export async function stats(): Promise<{ donations: number; profiles: number; reputationRows: number; cursor: string | null }> {
  const c = await db();
  const [d, p, rep, cur] = await Promise.all([
    c.execute(`SELECT COUNT(*) n FROM donations`),
    c.execute(`SELECT COUNT(*) n FROM profiles`),
    c.execute(`SELECT COUNT(*) n FROM reputation`),
    getCursor(),
  ]);
  return {
    donations: Number(d.rows[0].n),
    profiles: Number(p.rows[0].n),
    reputationRows: Number(rep.rows[0].n),
    cursor: cur,
  };
}

// ---- game texts (the words canisters refuse to hold) ----

export async function saveGameText(t: { id: string; game: string; handle: string; escrow?: string; body: string; salt?: string }): Promise<void> {
  const c = await db();
  await c.execute({
    sql: `INSERT INTO game_texts (id, game, handle, escrow, body, salt, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET body = excluded.body, escrow = COALESCE(excluded.escrow, game_texts.escrow)`,
    args: [t.id, t.game, t.handle.toLowerCase(), t.escrow ?? null, t.body, t.salt ?? null, now()],
  });
}

export async function listGameTexts(handle: string, game?: string): Promise<{ id: string; game: string; escrow: string | null; body: string; salt: string | null }[]> {
  const c = await db();
  const r = game
    ? await c.execute({ sql: `SELECT * FROM game_texts WHERE handle = ? AND game = ? ORDER BY created_at DESC LIMIT 200`, args: [handle.toLowerCase(), game] })
    : await c.execute({ sql: `SELECT * FROM game_texts WHERE handle = ? ORDER BY created_at DESC LIMIT 200`, args: [handle.toLowerCase()] });
  return r.rows.map((row) => ({
    id: String(row.id),
    game: String(row.game),
    escrow: row.escrow === null ? null : String(row.escrow),
    body: String(row.body),
    salt: row.salt === null ? null : String(row.salt),
  }));
}
