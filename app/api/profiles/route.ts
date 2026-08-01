import { NextRequest, NextResponse } from "next/server";
import { listProfiles, upsertProfile, getProfileOwner } from "@/lib/server/store";
import { verifySignedRequest } from "@/lib/server/auth";
import { readSession } from "@/lib/server/session";
import { allow } from "@/lib/server/ratelimit";
import { isValidAddress } from "@/lib/chain/config";
import { isDemoAddress } from "@/lib/data/session";
import { MOCK_STREAMERS } from "@/lib/data/mock";
import type { Profile } from "@/lib/data/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  — every registered page (the roster public pages resolve against).
// POST — create/update a page.
//   Ownership model (the wallet is the account, no passwords):
//   • real page (payout = real base58): wallet-signed request required.
//     New handle → the signer becomes the owner. Existing page → only the
//     owner's signature is accepted. A previously demo page is CLAIMED by
//     the first real signer (demo pages are explicitly throwaway).
//   • demo page (payout = demo placeholder / empty): unsigned allowed —
//     mock mode keeps working wallet-less — but an unsigned write can NEVER
//     touch an owned page, so squatting on real pages is impossible.
export async function GET() {
  const profiles = await listProfiles();
  return NextResponse.json({ profiles });
}

export async function POST(req: NextRequest) {
  if (!allow(req, "profiles-write", 20, 10)) return NextResponse.json({ error: "slow down" }, { status: 429 });

  let p: Profile;
  try {
    p = (await req.json()) as Profile;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  if (!p?.handle?.trim() || !p?.name?.trim()) {
    return NextResponse.json({ error: "handle and name required" }, { status: 400 });
  }
  // Built-in demo streamers (/@nova) resolve from code, not the DB. Letting anyone register the
  // same handle would split the identity: the profile page would show the DB row while the game
  // pages show the demo — two different people behind one link. Reserved outright.
  if (MOCK_STREAMERS[p.handle.trim().replace(/^@/, "").toLowerCase()]) {
    return NextResponse.json({ error: "this handle is reserved" }, { status: 409 });
  }
  const demoPage = !p.address || isDemoAddress(p.address);
  if (!demoPage && !isValidAddress(p.address)) {
    return NextResponse.json({ error: "invalid payout address" }, { status: 400 });
  }

  const existingOwner = await getProfileOwner(p.handle);
  // Two ways to prove you're the owner: a fresh wallet signature on this exact request, or the
  // editing session cookie you got by signing once at sign-in (/api/session). The session exists so
  // ordinary edits — renaming, moving a slider, picking a colour — don't each throw a wallet popup.
  const signed = await verifySignedRequest(req, "profile", p.handle, p);
  const sessionPubkey = readSession(req);
  const signer = signed ?? (sessionPubkey ? { pubkey: sessionPubkey } : null);

  if (existingOwner) {
    // Owned page: only its owner may write, no matter what the payload claims.
    if (!signer || signer.pubkey !== existingOwner) {
      return NextResponse.json({ error: "signature of the page owner required" }, { status: 403 });
    }
    await upsertProfile(p, existingOwner);
    return NextResponse.json({ ok: true });
  }

  // New or demo-owned page.
  if (demoPage && !signer) {
    await upsertProfile(p, "");
    return NextResponse.json({ ok: true });
  }
  if (!signer) {
    return NextResponse.json({ error: "wallet signature required for a real payout address" }, { status: 401 });
  }
  await upsertProfile(p, signer.pubkey);
  return NextResponse.json({ ok: true });
}
