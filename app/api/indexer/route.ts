import { NextRequest, NextResponse } from "next/server";
import { stats, insertDonation } from "@/lib/server/store";
import { tick, notifyTelegram } from "@/lib/server/indexer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  — mirror health: row counts + the last ingested signature.
// POST — force one ingest pass right now (the loop runs every 30s anyway).
//        {test: DonationRow} pushes a synthetic Settled through the REAL insert
//        path (intent merge + reputation fold) so the pipeline is testable
//        before the first live donation. This FORGES donations + reputation, so
//        it is double-locked: never in production, and — even in dev — only with
//        the CROWN_TEST_SECRET header. Unset secret = the hook is unavailable
//        (fail-closed), so a stray `next dev` box can't have fake money injected.
const TEST_SECRET = process.env.CROWN_TEST_SECRET;

export async function GET() {
  return NextResponse.json(await stats());
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (body?.test) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "test inserts are dev-only" }, { status: 403 });
    }
    if (!TEST_SECRET || req.headers.get("x-crown-test-secret") !== TEST_SECRET) {
      return NextResponse.json({ error: "test hook disabled — set CROWN_TEST_SECRET and send x-crown-test-secret" }, { status: 403 });
    }
    const t = body.test;
    const ok = await insertDonation({
      signature: String(t.signature),
      slot: Number(t.slot ?? 0),
      blockTime: t.blockTime ?? Math.floor(Date.now() / 1000),
      payer: String(t.payer),
      rawPayer: String(t.rawPayer ?? t.payer),
      streamer: String(t.streamer),
      gross: Number(t.gross),
      source: String(t.source ?? "direct"),
      donorName: null,
      message: null,
    });
    if (ok) void notifyTelegram(String(t.streamer), Number(t.gross));
    return NextResponse.json({ inserted: ok, ...(await stats()) });
  }
  const r = await tick();
  return NextResponse.json({ ...r, ...(await stats()) });
}
