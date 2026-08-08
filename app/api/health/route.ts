import { NextResponse } from "next/server";
import { stats } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bootedAt = Date.now();

// Liveness for a reverse proxy / uptime monitor: 200 with DB reachable,
// 503 when the database can't answer.
export async function GET() {
  try {
    const s = await stats();
    return NextResponse.json({
      ok: true,
      uptimeSeconds: Math.floor((Date.now() - bootedAt) / 1000),
      db: { donations: s.donations, profiles: s.profiles, indexerCursor: s.cursor },
    });
  } catch (e) {
    // Don't leak the raw error (DB path, driver internals) to the client — log it, answer generically.
    console.error("[health] db check failed", e);
    return NextResponse.json({ ok: false, error: "db unreachable" }, { status: 503 });
  }
}
