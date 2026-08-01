import { NextRequest, NextResponse } from "next/server";
import { listDonations } from "@/lib/server/store";
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
  return NextResponse.json({ donations });
}
