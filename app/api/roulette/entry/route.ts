import { NextRequest, NextResponse } from "next/server";
import { allow } from "@/lib/server/ratelimit";
import { RL_MAX_TITLE_BYTES } from "@/lib/chain/roulette";
import { authorizeHandleMutation } from "@/lib/server/auth";
import { getEntries, getEntriesForOwner, getRound, saveEntry, setEntryHidden } from "@/lib/server/roulette";
import { invalidateWheel } from "@/lib/server/rouletteChain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The title behind a slice.
//
// Open to anyone and unsigned on purpose: a memo can be assembled by any client,
// so whoever holds a preimage is not always whoever runs the page. Nothing is
// taken on trust — the title is accepted only if it hashes to the `entry_hex`
// claimed, under this round. A wrong preimage does not hash, and a slice whose
// preimage nobody publishes is an ordinary case that shows as a short key
// (`crown-games/roulette/docs/spec.md §Тексты`).
export async function POST(req: NextRequest) {
  if (!allow(req, "roulette-entry", 60, 10)) return NextResponse.json({ error: "slow down" }, { status: 429 });

  let body: { roundHex?: string; entryHex?: string; title?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const roundHex = (body.roundHex ?? "").trim().toLowerCase();
  const entryHex = (body.entryHex ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(roundHex) || !/^[0-9a-f]{64}$/.test(entryHex)) {
    return NextResponse.json({ error: "roundHex and entryHex must be 32 bytes of hex" }, { status: 400 });
  }
  const title = body.title ?? "";
  if (!title.trim() || new TextEncoder().encode(title).length > RL_MAX_TITLE_BYTES) {
    return NextResponse.json({ error: "title is empty or over the cap" }, { status: 400 });
  }

  const ok = await saveEntry({ roundHex, entryHex, title });
  // One answer for "no such round" and "this title is not that slice": both mean
  // the caller is naming something that does not exist.
  return ok
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "the title does not hash to that slice of that round" }, { status: 400 });
}

// Hide or unhide a title. Only the owner of the page the round belongs to, and
// only ever a display change: the slice keeps its key, its pool and its odds, and
// can win while hidden, because the verdict is computed over keys and never over
// words (`crown-games/roulette/docs/spec.md §Тексты`).
export async function PATCH(req: NextRequest) {
  if (!allow(req, "roulette-hide", 30, 10)) return NextResponse.json({ error: "slow down" }, { status: 429 });

  let body: { roundHex?: string; entryHex?: string; hidden?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const roundHex = (body.roundHex ?? "").trim().toLowerCase();
  const entryHex = (body.entryHex ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(roundHex) || !/^[0-9a-f]{64}$/.test(entryHex)) {
    return NextResponse.json({ error: "roundHex and entryHex must be 32 bytes of hex" }, { status: 400 });
  }

  const round = await getRound(roundHex);
  if (!round) return NextResponse.json({ error: "no such round" }, { status: 404 });
  const auth = await authorizeHandleMutation(req, "roulette-hide", round.handle, body);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  await setEntryHidden(roundHex, entryHex, body.hidden !== false);
  // The wheel is cached for a few seconds; moderation should not have to wait
  // for a clock to take a word off the page.
  invalidateWheel(roundHex);
  return NextResponse.json({ ok: true });
}

// Public by default: hidden titles are **absent**, not blanked, so a component
// that forgets to check a flag cannot leak one. `?owner=1` with the page owner's
// signature returns them — the maker has to see what they are hiding.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const roundHex = searchParams.get("round");
  if (!roundHex) return NextResponse.json({ error: "round required" }, { status: 400 });

  if (searchParams.get("owner") === "1") {
    const round = await getRound(roundHex);
    if (!round) return NextResponse.json({ error: "no such round" }, { status: 404 });
    const auth = await authorizeHandleMutation(req, "roulette-hide", round.handle, null);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
    return NextResponse.json(await getEntriesForOwner(roundHex));
  }
  return NextResponse.json(await getEntries(roundHex));
}
