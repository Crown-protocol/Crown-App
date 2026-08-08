import { NextRequest, NextResponse } from "next/server";
import { listDonations, listPendingDonations } from "@/lib/server/store";
import { getProfile } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The real donation feed — rows the indexer mirrored from finalized Settled
// events on devnet. ?handle= resolves the streamer's payout address via the
// profiles table; ?streamer= takes a base58 address directly.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  // Guard against NaN/Infinity: `?limit=abc` → Number("abc") is NaN, and `?? 40` doesn't catch NaN,
  // so it would reach the SQL LIMIT bind and throw ("only finite numbers…") → a 500 on a public GET.
  const rawLimit = Number(searchParams.get("limit"));
  const limit = Number.isFinite(rawLimit) ? rawLimit : 40;
  let streamer = searchParams.get("streamer") ?? undefined;

  const handle = searchParams.get("handle");
  if (handle && !streamer) {
    const p = await getProfile(handle);
    if (!p?.address) return NextResponse.json({ donations: [] });
    streamer = p.address;
  }

  const donations = await listDonations({ streamer, limit });

  // In-flight donations ride along, flagged. The cabinet shows them greyed with a "sending" pill so
  // a creator can tell "the money is on its way" from "nothing happened" — previously identical,
  // because only confirmed rows existed anywhere in the UI.
  //
  // Only when asked by handle: an intent is keyed by handle, not by payout address, so a ?streamer=
  // query has nothing to match against.
  const pending = handle ? await listPendingDonations({ handle, limit }) : [];

  return NextResponse.json({
    donations,
    pending: pending.map((p) => ({
      signature: p.signature,
      donorName: p.donorName,
      message: p.message,
      source: p.source,
      createdAt: p.createdAt,
    })),
  });
}
