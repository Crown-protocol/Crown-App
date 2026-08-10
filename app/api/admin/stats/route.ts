import { NextRequest, NextResponse } from "next/server";
import { readSession } from "@/lib/server/session";
import { OWNER_ADDRESS } from "@/lib/data/session";
import { dailyGross, opsOverview, topDonors, topRecipients } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The admin panel's numbers, all of them measured from mirrored `Settled` rows.
// Owner only, and 404 rather than 403 for the same reason the page is: a
// "forbidden" answer confirms the surface exists.
export async function GET(req: NextRequest) {
  if (readSession(req) !== OWNER_ADDRESS) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const [overview, recipients, donors, daily] = await Promise.all([
    opsOverview(),
    topRecipients(25),
    topDonors(25),
    dailyGross(30),
  ]);
  return NextResponse.json({ overview, recipients, donors, daily });
}
