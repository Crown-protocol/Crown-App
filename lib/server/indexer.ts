import { Connection, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { insertDonation, getCursor, setCursor, listProfiles, getDonationEvent } from "./store";
import { getLink, forwardDonation } from "./streamlabs";
import { readStore, writeStore, queueNotify } from "./telegram-store";

// ──────────────────────────────────────────────────────────────────
// The mirror indexer (step 9 of the project map): tails the splitter's
// finalized transactions on devnet, extracts Settled events and folds them
// into the DB (donations + reputation). This is what turns the chain feed
// and the reputation numbers into real data.
//
// Event layout (Cheer-Core event-CPI, verified against the repo):
//   inner instruction, program == splitter, data =
//   e445a52e51cb9a1d (event-CPI tag, 8) ‖ e8d228118e7c91ee (sha256("event:Settled")[..8])
//   ‖ payer (32) ‖ streamer (32) ‖ gross u64 LE (8)
// Escrow attribution: when the emitted payer is an escrow account owned by a
// pinned factory (discriminator 1fd57bbbba16da9b, donor at bytes 8..40), the
// book credits the DONOR — same rule as cheer-index.
// ──────────────────────────────────────────────────────────────────

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC || "https://api.devnet.solana.com";
const SPLITTER = new PublicKey(process.env.NEXT_PUBLIC_SPLITTER || "DKs2C9dRJSnZsERdD58cUVXMracvVTDS19PWvUz98GrN");
// The factory whose escrows we re-attribute to their donor — the same
// recognition root crown-indexer pins (`config/testnet.toml`), and the only
// escrow form this app ships.
const FACTORIES = [
  process.env.NEXT_PUBLIC_FACTORY_TWO_OUTCOME || "BGVQrwSwkFQspL69DjGBFgKSgL6rutPqgcgEskmi8A4y",
];

const EVENT_TAG = Buffer.from("e445a52e51cb9a1d", "hex");
const SETTLED_DISC = Buffer.from("e8d228118e7c91ee", "hex");
const ESCROW_DISC = Buffer.from("1fd57bbbba16da9b", "hex");

const conn = new Connection(RPC_URL, "finalized");

interface Settled {
  payer: string;
  streamer: string;
  gross: number;
}

function parseSettledFromData(dataB58: string): Settled | null {
  let raw: Buffer;
  try {
    raw = Buffer.from(bs58.decode(dataB58));
  } catch {
    return null;
  }
  if (raw.length !== 88) return null;
  if (!raw.subarray(0, 8).equals(EVENT_TAG) || !raw.subarray(8, 16).equals(SETTLED_DISC)) return null;
  return {
    payer: new PublicKey(raw.subarray(16, 48)).toBase58(),
    streamer: new PublicKey(raw.subarray(48, 80)).toBase58(),
    gross: Number(raw.readBigUInt64LE(80)),
  };
}

// When the emitted payer is a live escrow account of a pinned factory, the
// donation belongs to its donor. If the escrow is already closed we keep the
// raw payer — the same honesty rule cheer-index applies (anomaly, not a guess).
async function attribute(rawPayer: string): Promise<{ payer: string; source: string }> {
  try {
    await new Promise((r) => setTimeout(r, 350));
    const info = await conn.getAccountInfo(new PublicKey(rawPayer));
    if (info && FACTORIES.includes(info.owner.toBase58()) && info.data.length >= 72 && info.data.subarray(0, 8).equals(ESCROW_DISC)) {
      return { payer: new PublicKey(info.data.subarray(8, 40)).toBase58(), source: "escrow" };
    }
  } catch (e) {
    // A rate limit here must STOP the pass, not silently mis-attribute an
    // escrow settle as a direct donation — that row would be wrong forever.
    if (String((e as Error)?.message ?? e).includes("429")) throw e;
  }
  return { payer: rawPayer, source: "direct" };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isRateLimit = (e: unknown) => String((e as Error)?.message ?? e).includes("429");

// One pass: everything newer than the cursor, oldest-first. Returns how many
// new donations landed.
//
// Built for the FREE public devnet RPC, which rate-limits bursts hard:
// small batches, a polite gap between getTransaction calls, the cursor
// advances after EVERY processed signature (so a mid-pass 429 never makes
// the next pass re-scan what's done), and a 429 ends the pass quietly —
// the next tick picks up exactly where this one stopped.
export async function tick(): Promise<{ ingested: number; scanned: number }> {
  const cursor = await getCursor();
  let sigs;
  try {
    sigs = await conn.getSignaturesForAddress(SPLITTER, { until: cursor ?? undefined, limit: 40 }, "finalized");
  } catch (e) {
    if (isRateLimit(e)) return { ingested: 0, scanned: 0 };
    throw e;
  }
  if (!sigs.length) return { ingested: 0, scanned: 0 };

  let ingested = 0;
  let scanned = 0;
  for (const s of [...sigs].reverse()) {
    if (s.err) {
      await setCursor(s.signature);
      continue; // failed txs emit nothing
    }
    let tx;
    try {
      await sleep(400); // stay under the public RPC's per-method budget
      tx = await conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: "finalized" });
    } catch (e) {
      if (isRateLimit(e)) return { ingested, scanned }; // resume here next tick
      throw e;
    }
    scanned++;
    if (!tx?.meta) {
      await setCursor(s.signature);
      continue;
    }

    // Full key list (v0 txs append looked-up addresses after the static keys).
    const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses ?? undefined });
    const splitterIdx = keys.staticAccountKeys.concat(keys.accountKeysFromLookups?.writable ?? [], keys.accountKeysFromLookups?.readonly ?? []).findIndex((k) => k.equals(SPLITTER));
    if (splitterIdx === -1) continue;

    const inner = (tx.meta.innerInstructions ?? []).flatMap((g) => g.instructions);
    // A transaction can carry SEVERAL Settled events (the splitter paying more than one
    // recipient). Each is its own donation, so each gets its own position — the donations row is
    // keyed by (signature, ev_index). Counting only parsed events keeps the index stable across
    // re-scans: it doesn't shift if unrelated inner instructions come or go.
    let evIndex = -1;
    for (const ix of inner) {
      if (ix.programIdIndex !== splitterIdx) continue;
      const ev = parseSettledFromData(ix.data);
      if (!ev) continue;
      evIndex++;
      let att;
      try {
        att = await attribute(ev.payer);
      } catch {
        return { ingested, scanned }; // rate-limited mid-event: resume next tick
      }
      const isNew = await insertDonation({
        signature: s.signature,
        evIndex,
        slot: s.slot,
        blockTime: s.blockTime ?? null,
        payer: att.payer,
        rawPayer: ev.payer,
        streamer: ev.streamer,
        gross: ev.gross,
        source: att.source,
        donorName: null,
        message: null,
      });
      if (isNew) {
        ingested++;
        // The streamer's Telegram, if connected: a REAL devnet donation just
        // landed in their mirror. Address → handle via the profiles table;
        // strangers' pages simply have no handle and no chat to ring.
        void notifyTelegram(ev.streamer, ev.gross);
        // …and into the streamer's own Streamlabs alert box, if they connected one. Fire-and-forget
        // for the same reason as above: their outage must never stall ingest of money.
        void notifyStreamlabs(ev.streamer, ev.gross, s.signature, evIndex);
      }
    }
    // Progress survives a mid-pass rate limit: this signature is done for good.
    await setCursor(s.signature);
  }
  return { ingested, scanned };
}

// Background loop, one per server process (dev HMR re-imports modules — the
// globalThis guard keeps exactly one interval alive).
const LOOP_KEY = Symbol.for("cheer.indexer.loop");

export function startIndexerLoop(intervalMs = 30_000): void {
  const g = globalThis as { [LOOP_KEY]?: boolean };
  if (g[LOOP_KEY]) return;
  g[LOOP_KEY] = true;
  const run = () => {
    tick()
      .then((r) => {
        if (r.ingested) console.log(`[indexer] +${r.ingested} donations (scanned ${r.scanned} txs)`);
      })
      .catch((e) => console.warn("[indexer] tick failed:", e?.message ?? e));
  };
  run();
  setInterval(run, intervalMs);
}

// Mirror a freshly ingested donation into the streamer's Streamlabs alert box, so it fires through
// the overlay they already built there. Silent when they never connected Streamlabs, and never
// throws — see lib/server/streamlabs.ts.
export async function notifyStreamlabs(addr: string, gross: number, signature: string, evIndex: number): Promise<void> {
  try {
    const profiles = await listProfiles();
    const hit = profiles.find((p) => p.address === addr);
    if (!hit) return;
    const link = await getLink(hit.handle);
    if (!link) return; // not connected — nothing to do, and no work done
    // Read the EXACT event we're firing for by (signature, ev_index) — not "the most recent donation
    // to this streamer", which attached the wrong donor's name/message/payer whenever two events
    // landed close together or one tx paid several recipients. Its donor_name/message already carry
    // whatever the intent decorated in insertDonation.
    const row = await getDonationEvent(signature, evIndex);
    await forwardDonation({
      handle: hit.handle,
      from: row?.donorName || "Anonymous",
      amount: gross / 1e6,
      message: row?.message ?? null,
      signature,
      donorId: row?.payer ?? null,
    });
  } catch {}
}

// Fire-and-forget Telegram ping for a freshly mirrored donation. Never throws:
// a broken notification must not break ingest.
export async function notifyTelegram(addr: string, gross: number): Promise<void> {
  try {
    const profiles = await listProfiles();
    const hit = profiles.find((p) => p.address === addr);
    if (!hit) return;
    const s = await readStore();
    // Same format as the site: cents when there are cents, never a bare "0.98000001"
    // and never a rounded "1" for money that wasn't a dollar.
    const amount = gross / 1e6;
    const shown = Number.isInteger(amount) ? amount.toLocaleString("en-US") : amount.toFixed(2);
    const queued = await queueNotify(s, hit.handle.toLowerCase(), "donation", `A donation arrived — $${shown}`, "It's already in your wallet.");
    if (queued) await writeStore(s);
  } catch {}
}
