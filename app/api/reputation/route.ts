import { NextRequest, NextResponse } from "next/server";
import { reputationOf, reputationPair } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The mirror book. ?payer=<base58> → every streamer this wallet has honestly
// paid; add &streamer=<base58> for one pair. Totals are USDC minor units —
// the same unit cheer-index returns, so the two sources are interchangeable.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const payer = searchParams.get("payer");
  if (!payer) return NextResponse.json({ error: "payer required" }, { status: 400 });

  const streamer = searchParams.get("streamer");
  if (streamer) {
    const total = await reputationPair(payer, streamer);
    return NextResponse.json({ payer, streamer, total });
  }
  const rows = await reputationOf(payer);
  return NextResponse.json({ payer, rows });
}
