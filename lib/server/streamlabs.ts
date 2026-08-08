import crypto from "crypto";
import { db } from "./db";

// ── Cheer donations → Streamlabs alerts ──────────────────────────────────────────────────────
// A streamer who already has a Streamlabs alert box (their fonts, their sound, their animation)
// shouldn't have to rebuild it for Cheer. Connecting their Streamlabs account here makes every
// real Cheer donation fire through THEIR existing alert, alongside their other platforms.
//
// We post to /donations rather than /alerts on purpose: it shows the alert AND records the amount
// in their Streamlabs totals, so goals and leaderboards there stay honest. /alerts is display-only.
// API: https://dev.streamlabs.com/ — v2.0. The endpoints are the same as v1.0 apart from the
// version in the path, but v2.0 accepts the access token ONLY as a Bearer header; passing it as a
// parameter (which v1.0 allowed) is rejected. v1.0 is being retired, so we target v2.0 directly.

const TOKEN_URL = "https://streamlabs.com/api/v2.0/token";
const DONATIONS_URL = "https://streamlabs.com/api/v2.0/donations";

// Streamlabs' own guidance is ~2 alerts per minute per user. A donation burst must not get the
// streamer's account throttled, so we pace our posts rather than firing everything at once.
const MIN_GAP_MS = 30_000;

export interface SlLink {
  handle: string;
  accessToken: string;
  refreshToken: string | null;
  /** epoch ms, 0 when the API didn't tell us */
  expiresAt: number;
  slUser: string | null;
}

async function ensureTable(): Promise<void> {
  const c = await db();
  await c.execute(`CREATE TABLE IF NOT EXISTS streamlabs_links (
    handle TEXT PRIMARY KEY,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    expires_at INTEGER NOT NULL DEFAULT 0,
    sl_user TEXT,
    last_sent_at INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`);
}

export async function saveLink(l: Omit<SlLink, "slUser"> & { slUser?: string | null }): Promise<void> {
  await ensureTable();
  const c = await db();
  await c.execute({
    sql: `INSERT INTO streamlabs_links (handle, access_token, refresh_token, expires_at, sl_user, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(handle) DO UPDATE SET access_token = excluded.access_token,
            refresh_token = excluded.refresh_token, expires_at = excluded.expires_at,
            sl_user = excluded.sl_user`,
    args: [l.handle.toLowerCase(), l.accessToken, l.refreshToken, l.expiresAt, l.slUser ?? null, Date.now()],
  });
}

export async function getLink(handle: string): Promise<SlLink | null> {
  await ensureTable();
  const c = await db();
  const r = await c.execute({ sql: `SELECT * FROM streamlabs_links WHERE handle = ?`, args: [handle.toLowerCase()] });
  if (!r.rows.length) return null;
  const row = r.rows[0];
  return {
    handle: String(row.handle),
    accessToken: String(row.access_token),
    refreshToken: row.refresh_token === null ? null : String(row.refresh_token),
    expiresAt: Number(row.expires_at ?? 0),
    slUser: row.sl_user === null ? null : String(row.sl_user),
  };
}

export async function removeLink(handle: string): Promise<void> {
  await ensureTable();
  const c = await db();
  await c.execute({ sql: `DELETE FROM streamlabs_links WHERE handle = ?`, args: [handle.toLowerCase()] });
}

// Swap an expiring access token for a fresh one. Streamlabs tokens are long-lived but not
// permanent; without this the integration would quietly stop working weeks later, which is the
// worst kind of failure — the streamer thinks it works and it doesn't.
async function refresh(link: SlLink): Promise<SlLink | null> {
  const id = process.env.STREAMLABS_CLIENT_ID;
  const secret = process.env.STREAMLABS_CLIENT_SECRET;
  const redirect = process.env.STREAMLABS_REDIRECT_URI;
  if (!id || !secret || !redirect || !link.refreshToken) return null;
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        client_id: id,
        client_secret: secret,
        redirect_uri: redirect,
        refresh_token: link.refreshToken,
      }),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!j.access_token) return null;
    const next: SlLink = {
      ...link,
      accessToken: j.access_token,
      refreshToken: j.refresh_token ?? link.refreshToken,
      expiresAt: j.expires_in ? Date.now() + j.expires_in * 1000 : 0,
    };
    await saveLink(next);
    return next;
  } catch {
    return null;
  }
}

/** Exchange an OAuth code for tokens. Returns null on any failure — the caller shows an error. */
export async function exchangeCode(code: string): Promise<{ accessToken: string; refreshToken: string | null; expiresAt: number } | null> {
  const id = process.env.STREAMLABS_CLIENT_ID;
  const secret = process.env.STREAMLABS_CLIENT_SECRET;
  const redirect = process.env.STREAMLABS_REDIRECT_URI;
  if (!id || !secret || !redirect) return null;
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant_type: "authorization_code", client_id: id, client_secret: secret, redirect_uri: redirect, code }),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!j.access_token) return null;
    return {
      accessToken: j.access_token,
      refreshToken: j.refresh_token ?? null,
      expiresAt: j.expires_in ? Date.now() + j.expires_in * 1000 : 0,
    };
  } catch {
    return null;
  }
}

// ── OAuth `state` ────────────────────────────────────────────────────────────────────────────
// Carries the handle being linked, signed, so the callback can tell an approval we started from
// one forged elsewhere. Reuses the session secret; in dev it falls back like sessions do.
function stateKey(): string | null {
  const k = process.env.CHEER_SESSION_SECRET;
  if (k && k.length >= 16) return k;
  if (process.env.NODE_ENV !== "production") return "cheer-dev-session-secret-not-for-production";
  return null;
}

export function signState(handle: string): string | null {
  const key = stateKey();
  if (!key) return null;
  const payload = `${handle.toLowerCase()}.${Math.floor(Date.now() / 1000)}`;
  const mac = crypto.createHmac("sha256", key).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

/** Returns the handle a state token vouches for, or null if it's forged or stale. */
export function readState(state: string): string | null {
  const key = stateKey();
  if (!key) return null;
  const parts = state.split(".");
  if (parts.length !== 3) return null;
  const [handle, ts, mac] = parts;
  const expect = crypto.createHmac("sha256", key).update(`${handle}.${ts}`).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  // An approval left half-finished for an hour is a stale tab, not a live consent.
  if (Math.floor(Date.now() / 1000) - Number(ts) > 3600) return null;
  return handle;
}

/** Is the integration configured at all? Without the app credentials the button must not appear. */
export function streamlabsConfigured(): boolean {
  return !!(process.env.STREAMLABS_CLIENT_ID && process.env.STREAMLABS_CLIENT_SECRET && process.env.STREAMLABS_REDIRECT_URI);
}

// Push one Cheer donation into the streamer's Streamlabs alert box.
//
// Never throws and never blocks ingest: a Streamlabs outage must not stop the indexer from
// recording money. Returns what happened so the cabinet can show an honest status.
export async function forwardDonation(opts: {
  handle: string;
  from: string;
  /** dollars */
  amount: number;
  message?: string | null;
  /** the donation's signature — groups a donor and keeps retries idempotent on their side */
  signature: string;
  donorId?: string | null;
}): Promise<"sent" | "skipped" | "unlinked" | "failed"> {
  try {
    let link = await getLink(opts.handle);
    if (!link) return "unlinked";

    // Refresh slightly early: a token that dies mid-post would drop that alert entirely.
    if (link.expiresAt && link.expiresAt - Date.now() < 60_000) {
      link = (await refresh(link)) ?? link;
    }

    // Pace against their recommended rate: two alerts seconds apart risk the streamer's Streamlabs
    // account being throttled. But dropping the second one (the old behaviour) silently lost a real
    // donation's alert during any burst. Instead we DEFER it — wait out the remaining gap in-process,
    // then send — so both donations get their alert, just spaced. This call is already fire-and-forget
    // from the indexer, so the wait never blocks ingest. Capped so a long backlog can't pile up an
    // unbounded delay; past the cap we send immediately and accept the small throttle risk.
    await ensureTable();
    const c = await db();
    const gapRow = await c.execute({ sql: `SELECT last_sent_at FROM streamlabs_links WHERE handle = ?`, args: [opts.handle.toLowerCase()] });
    const last = gapRow.rows.length ? Number(gapRow.rows[0].last_sent_at ?? 0) : 0;
    const sinceLast = last ? Date.now() - last : MIN_GAP_MS;
    if (sinceLast < MIN_GAP_MS) {
      const wait = Math.min(MIN_GAP_MS - sinceLast, MIN_GAP_MS); // never wait longer than one gap
      await new Promise((res) => setTimeout(res, wait));
      // Re-stamp so a third alert queued behind this one paces off THIS send, not the stale value.
      await c.execute({ sql: `UPDATE streamlabs_links SET last_sent_at = ? WHERE handle = ?`, args: [Date.now(), opts.handle.toLowerCase()] });
    }

    const body = new URLSearchParams({
      name: (opts.from || "Anonymous").slice(0, 25),
      // Their docs ask for a stable per-donor identifier so repeat donors group together.
      identifier: (opts.donorId || opts.from || "anonymous").slice(0, 64),
      amount: String(opts.amount),
      currency: "USD",
    });
    // Their limit is 255; trim rather than let the whole call fail on a long message.
    if (opts.message) body.set("message", opts.message.slice(0, 255));

    const res = await fetch(DONATIONS_URL, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        // v2.0 takes the token here and only here.
        authorization: `Bearer ${link.accessToken}`,
      },
      body,
    });
    if (!res.ok) return "failed";

    await c.execute({
      sql: `UPDATE streamlabs_links SET last_sent_at = ? WHERE handle = ?`,
      args: [Date.now(), opts.handle.toLowerCase()],
    });
    return "sent";
  } catch {
    return "failed";
  }
}
