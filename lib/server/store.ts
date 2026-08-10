import { db, now } from "./db";
import type { Profile } from "@/lib/data/types";

// ──────────────────────────────────────────────────────────────────
// Domain operations over the Cheer DB. Thin, typed, raw-SQL — every
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

// Profiles are stored as raw JSON blobs, and older/partial rows may be missing array fields the
// Profile type promises are ALWAYS present — socials and tiers. A row written before a field existed
// (or by a client that dropped an empty array) then crashed every consumer that did
// `profile.socials.map(...)`: the catalog, every public page, the game pages. Normalize the two
// non-optional arrays on the way OUT so the type's guarantee actually holds for every reader — one
// place, instead of a `?? []` scattered across every render site. (widgets/donatePresets are optional
// in the type and already guarded at their use sites, so they're left as-is.)
function parseProfile(data: unknown): Profile {
  const p = JSON.parse(String(data)) as Profile;
  return {
    ...p,
    socials: Array.isArray(p.socials) ? p.socials : [],
    tiers: Array.isArray(p.tiers) ? p.tiers : [],
  };
}

export async function getProfile(handle: string): Promise<Profile | null> {
  const c = await db();
  const r = await c.execute({ sql: `SELECT data FROM profiles WHERE handle = ?`, args: [handle.toLowerCase()] });
  return r.rows.length ? parseProfile(r.rows[0].data) : null;
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
  return r.rows.length ? parseProfile(r.rows[0].data) : null;
}

/**
 * The roster of registered pages.
 *
 * `withAvatars` decides whether each row carries its inline avatar data: URL. That one field IS the
 * payload — measured over the live table, the whole roster is 487KB with avatars and 3KB without.
 * The root DataProvider fetches this list on every page load just to resolve handles → addresses, so
 * shipping avatars there put half a megabyte in front of every first paint. Surfaces that actually
 * render faces (/discover) ask for them explicitly; a maker's own page loads its full profile from
 * /api/profiles/[handle] anyway, avatar included.
 */
export async function listProfiles(opts?: { withAvatars?: boolean }): Promise<Profile[]> {
  const c = await db();
  const r = await c.execute(`SELECT data FROM profiles ORDER BY updated_at DESC LIMIT 500`);
  const rows = r.rows.map((row) => parseProfile(row.data));
  if (opts?.withAvatars) return rows;
  return rows.map((p) => {
    // Drop the bytes, keep the flag: `avatarEnabled` is what tells a surface whether to leave room
    // for a face or fall back to the monogram, and it costs nothing.
    const { avatarUrl: _drop, ...rest } = p;
    return rest as Profile;
  });
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
  /** Which Settled event this is inside its transaction — a tx may carry several. */
  evIndex: number;
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
    const dup = await tx.execute({ sql: `SELECT 1 FROM donations WHERE signature = ? AND ev_index = ?`, args: [d.signature, d.evIndex] });
    if (dup.rows.length) {
      await tx.rollback();
      return false;
    }
    // A pre-declared intent (donor's name/message for this signature) decorates the row.
    const intent = await tx.execute({ sql: `SELECT donor_name, message, source FROM donation_intents WHERE signature = ?`, args: [d.signature] });
    const donorName = intent.rows.length ? ((intent.rows[0].donor_name as string) ?? d.donorName) : d.donorName;
    const message = intent.rows.length ? ((intent.rows[0].message as string) ?? d.message) : d.message;
    // Source (provenance) is the INDEXER's to decide, not the client's. The indexer resolves it from
    // chain — "escrow" when the emitted payer is a live escrow account (a game settle), "direct"
    // otherwise. The intent's `source` is a client hint that defaults to "direct"; taking it
    // unconditionally overwrote a real "escrow" settle as "direct" — a permanently-wrong provenance.
    // So the indexer's own value wins whenever it determined an escrow settle; only when the indexer
    // saw a plain "direct" do we let a more specific intent hint (task/roulette/fundraiser)
    // refine which game it came through.
    const intentSource = intent.rows.length ? String(intent.rows[0].source) : "";
    const source = d.source !== "direct" ? d.source : intentSource || d.source;

    await tx.execute({
      sql: `INSERT INTO donations (signature, ev_index, slot, block_time, payer, raw_payer, streamer, gross, source, donor_name, message, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [d.signature, d.evIndex, d.slot, d.blockTime, d.payer, d.rawPayer, d.streamer, d.gross, source, donorName, message, now()],
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
  // The tx may already be indexed by the time the intent arrives — decorate in place. Fill each field
  // ONLY where it's still empty (COALESCE keeps an already-set value, so this never overwrites), and
  // gate the whole UPDATE on "at least one field is empty" rather than "BOTH are empty". The old
  // `donor_name IS NULL AND message IS NULL` meant a donation already carrying a name (from a first
  // intent) could never receive its message from a second intent — a plausible name-then-message
  // client flow silently lost the message.
  await c.execute({
    sql: `UPDATE donations
             SET donor_name = COALESCE(donor_name, ?),
                 message    = COALESCE(message, ?)
           WHERE signature = ? AND (donor_name IS NULL OR message IS NULL)`,
    args: [i.donorName ?? null, i.message ?? null, i.signature],
  });
}

// Donations that were SENT but haven't been seen on-chain yet.
//
// An intent row is written the moment a donor submits; the indexer later matches it to a finalized
// Settled event and writes the real donation. Until that happens the money is genuinely in flight —
// but the cabinet showed nothing at all, so a creator watching a stream saw a viewer donate and
// then… silence, for as long as finalization took. That gap is what "is it stuck or did it work?"
// feels like from the other side.
//
// Anything already present in `donations` is excluded by signature: once confirmed, the confirmed
// row is the truth and showing both would double-count the money.
export async function listPendingDonations(opts: { handle?: string; limit?: number }): Promise<
  { signature: string; handle: string; donorName: string | null; message: string | null; source: string; createdAt: number }[]
> {
  const c = await db();
  const limit = Math.min(Math.max(opts.limit ?? 40, 1), 200);
  const where = opts.handle ? `WHERE i.handle = ? AND` : `WHERE`;
  const args: (string | number)[] = opts.handle ? [opts.handle.toLowerCase(), limit] : [limit];
  const r = await c.execute({
    sql: `SELECT i.* FROM donation_intents i
          ${where} NOT EXISTS (SELECT 1 FROM donations d WHERE d.signature = i.signature)
          ORDER BY i.created_at DESC LIMIT ?`,
    args,
  });
  return r.rows.map((row) => ({
    signature: String(row.signature),
    handle: String(row.handle),
    donorName: row.donor_name === null ? null : String(row.donor_name),
    message: row.message === null ? null : String(row.message),
    source: String(row.source ?? "direct"),
    createdAt: Number(row.created_at),
  }));
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
    evIndex: Number(row.ev_index ?? 0),
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

// One exact donation event by its (signature, ev_index). The Streamlabs/Telegram notifiers need the
// row they were fired FOR — not "the most recent donation to this streamer", which mis-attributes the
// donor's name/message/payer whenever two events land close together or a tx pays several recipients.
export async function getDonationEvent(signature: string, evIndex: number): Promise<DonationRow | null> {
  const c = await db();
  const r = await c.execute({ sql: `SELECT * FROM donations WHERE signature = ? AND ev_index = ?`, args: [signature, evIndex] });
  if (!r.rows.length) return null;
  const row = r.rows[0];
  return {
    signature: String(row.signature),
    evIndex: Number(row.ev_index ?? 0),
    slot: Number(row.slot),
    blockTime: row.block_time === null ? null : Number(row.block_time),
    payer: String(row.payer),
    rawPayer: String(row.raw_payer),
    streamer: String(row.streamer),
    gross: Number(row.gross),
    source: String(row.source),
    donorName: row.donor_name === null ? null : String(row.donor_name),
    message: row.message === null ? null : String(row.message),
  };
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

// ---- operations: the platform's own numbers, all of them measured ----
//
// Everything here is a query over rows the indexer wrote from finalized `Settled`
// events, i.e. money that actually moved. There is deliberately no "estimated",
// "projected" or seeded figure: the admin panel used to open on invented totals,
// and a dashboard that can show a plausible number nobody earned is worse than
// an empty one.

export interface OpsOverview {
  profiles: number;
  donations: number;
  grossTotal: number; // USDC minor units
  gross30d: number;
  donations30d: number;
  donors: number; // distinct paying wallets
  recipients: number; // distinct paid wallets
  cursor: string | null;
}

export async function opsOverview(): Promise<OpsOverview> {
  const c = await db();
  const since = now() - 30 * 86400;
  const [p, all, recent, people] = await Promise.all([
    c.execute(`SELECT COUNT(*) n FROM profiles`),
    c.execute(`SELECT COUNT(*) n, COALESCE(SUM(gross),0) g FROM donations`),
    c.execute({
      sql: `SELECT COUNT(*) n, COALESCE(SUM(gross),0) g FROM donations WHERE COALESCE(block_time, created_at) >= ?`,
      args: [since],
    }),
    c.execute(`SELECT COUNT(DISTINCT payer) d, COUNT(DISTINCT streamer) r FROM donations`),
  ]);
  return {
    profiles: Number(p.rows[0].n),
    donations: Number(all.rows[0].n),
    grossTotal: Number(all.rows[0].g),
    gross30d: Number(recent.rows[0].g),
    donations30d: Number(recent.rows[0].n),
    donors: Number(people.rows[0].d),
    recipients: Number(people.rows[0].r),
    cursor: await getCursor(),
  };
}

/** Creators by money actually received, joined to a page when one is registered. */
export async function topRecipients(limit = 25): Promise<
  { address: string; handle: string | null; name: string | null; gross: number; count: number; last: number | null }[]
> {
  const c = await db();
  const r = await c.execute({
    sql: `SELECT d.streamer address, p.handle, p.name,
                 SUM(d.gross) gross, COUNT(*) count, MAX(COALESCE(d.block_time, d.created_at)) last
          FROM donations d
          LEFT JOIN profiles p ON p.address = d.streamer
          GROUP BY d.streamer
          ORDER BY gross DESC
          LIMIT ?`,
    args: [limit],
  });
  return r.rows.map((x) => ({
    address: String(x.address),
    handle: x.handle === null ? null : String(x.handle),
    name: x.name === null ? null : String(x.name),
    gross: Number(x.gross),
    count: Number(x.count),
    last: x.last === null ? null : Number(x.last),
  }));
}

/** Donors by money actually given — the book's own view, mirrored. */
export async function topDonors(limit = 25): Promise<
  { payer: string; gross: number; count: number; recipients: number; last: number | null }[]
> {
  const c = await db();
  const r = await c.execute({
    sql: `SELECT payer, SUM(gross) gross, COUNT(*) count,
                 COUNT(DISTINCT streamer) recipients, MAX(COALESCE(block_time, created_at)) last
          FROM donations
          GROUP BY payer
          ORDER BY gross DESC
          LIMIT ?`,
    args: [limit],
  });
  return r.rows.map((x) => ({
    payer: String(x.payer),
    gross: Number(x.gross),
    count: Number(x.count),
    recipients: Number(x.recipients),
    last: x.last === null ? null : Number(x.last),
  }));
}

/** Daily totals for the last `days` days — the only series the panel draws. */
export async function dailyGross(days = 30): Promise<{ date: string; gross: number; count: number }[]> {
  const c = await db();
  const since = now() - days * 86400;
  const r = await c.execute({
    sql: `SELECT date(COALESCE(block_time, created_at), 'unixepoch') day,
                 SUM(gross) gross, COUNT(*) count
          FROM donations
          WHERE COALESCE(block_time, created_at) >= ?
          GROUP BY day
          ORDER BY day`,
    args: [since],
  });
  return r.rows.map((x) => ({ date: String(x.day), gross: Number(x.gross), count: Number(x.count) }));
}

// ---- game texts (the words canisters refuse to hold) ----

// Returns false when the id already belongs to a DIFFERENT page — the caller authorised the write
// against its own handle, so it must not land on someone else's row.
//
// The route checks the signature against `handle`, but the upsert used to match on `id` alone:
// owner A, signing correctly for their own page, could overwrite the text of page B just by
// knowing B's id (a task id is the escrow address — public on chain). The handle is now part of
// the match, so a mismatched id updates nothing and the caller is told.
export async function saveGameText(t: { id: string; game: string; handle: string; escrow?: string; body: string; salt?: string }): Promise<boolean> {
  const c = await db();
  const handle = t.handle.toLowerCase();
  const r = await c.execute({
    sql: `INSERT INTO game_texts (id, game, handle, escrow, body, salt, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET body = excluded.body, escrow = COALESCE(excluded.escrow, game_texts.escrow)
          WHERE game_texts.handle = ?`,
    args: [t.id, t.game, handle, t.escrow ?? null, t.body, t.salt ?? null, now(), handle],
  });
  // The conflict path with a failing WHERE changes nothing — that's the cross-page attempt.
  return r.rowsAffected > 0;
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
