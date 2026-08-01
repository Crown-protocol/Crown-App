import { NextRequest, NextResponse } from "next/server";
import { readStore, writeStore } from "@/lib/server/telegram-store";
import { authorizeHandleChannel } from "@/lib/server/auth";
import { allow } from "@/lib/server/ratelimit";
import type { NotifUrgency } from "@/lib/data/notifications";

// Toggles from the cabinet panel — same switches the bot's /settings keyboard flips.
// Owner-gated: another streamer's notification categories aren't yours to flip.
export async function POST(req: NextRequest) {
  if (!allow(req, "tg-prefs", 40, 20)) return NextResponse.json({ error: "slow down" }, { status: 429 });

  const raw = (await req.json().catch(() => null)) as {
    handle?: string;
    categories?: Partial<Record<NotifUrgency, boolean>>;
    monthly?: boolean;
  } | null;
  const handle = raw?.handle;
  const categories = raw?.categories;
  const monthly = raw?.monthly;
  if (!handle) return NextResponse.json({ error: "handle required" }, { status: 400 });

  const auth = await authorizeHandleChannel(req, "tg-prefs", handle, raw);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const s = await readStore();
  const link = s.links[handle];
  if (!link) return NextResponse.json({ error: "not linked" }, { status: 404 });

  if (categories) Object.assign(link.categories, categories);
  if (typeof monthly === "boolean") link.monthly = monthly;
  await writeStore(s);
  return NextResponse.json({ ok: true, categories: link.categories, monthly: link.monthly });
}
