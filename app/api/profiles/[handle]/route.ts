import { NextRequest, NextResponse } from "next/server";
import { getProfile, deleteProfile, getProfileOwner } from "@/lib/server/store";
import { verifySignedRequest } from "@/lib/server/auth";
import { readSession } from "@/lib/server/session";
import { allow } from "@/lib/server/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { handle: string } }) {
  const p = await getProfile(decodeURIComponent(params.handle).replace(/^@/, ""));
  if (!p) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ profile: p });
}

// Deleting an OWNED page needs the owner's signature; demo pages (owner '')
// stay deletable unsigned — they're the wallet-less mock flow's throwaways.
export async function DELETE(req: NextRequest, { params }: { params: { handle: string } }) {
  if (!allow(req, "profiles-write", 20, 10)) return NextResponse.json({ error: "slow down" }, { status: 429 });
  const handle = decodeURIComponent(params.handle).replace(/^@/, "");
  const owner = await getProfileOwner(handle);
  if (owner === null) return NextResponse.json({ ok: true }); // nothing to delete
  if (owner) {
    const signedDel = await verifySignedRequest(req, "delete", handle, null);
  const sessionDel = readSession(req);
  const signer = signedDel ?? (sessionDel ? { pubkey: sessionDel } : null);
    if (!signer || signer.pubkey !== owner) {
      return NextResponse.json({ error: "signature of the page owner required" }, { status: 403 });
    }
  }
  await deleteProfile(handle);
  return NextResponse.json({ ok: true });
}
