import { NextRequest, NextResponse } from "next/server";
import { getLink, removeLink, streamlabsConfigured } from "@/lib/server/streamlabs";
import { readSession } from "@/lib/server/session";
import { getProfileOwner } from "@/lib/server/store";
import { allow } from "@/lib/server/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Is this page's Streamlabs connected? The cabinet asks on load so the button can read "Connect"
// or "Connected · Disconnect". Never returns the tokens themselves — only whether one exists.
export async function GET(req: NextRequest) {
  const handle = (new URL(req.url).searchParams.get("handle") ?? "").replace(/^@/, "").trim();
  if (!handle) return NextResponse.json({ error: "handle required" }, { status: 400 });
  const link = await getLink(handle);
  return NextResponse.json({ available: streamlabsConfigured(), connected: !!link });
}

// Disconnect. Same ownership rule as connecting: an owned page needs its owner's session.
export async function DELETE(req: NextRequest) {
  if (!allow(req, "sl-disconnect", 10, 10)) return NextResponse.json({ error: "slow down" }, { status: 429 });
  const handle = (new URL(req.url).searchParams.get("handle") ?? "").replace(/^@/, "").trim().toLowerCase();
  if (!handle) return NextResponse.json({ error: "handle required" }, { status: 400 });

  const owner = await getProfileOwner(handle);
  if (owner) {
    const signer = readSession(req);
    if (!signer || signer !== owner) {
      return NextResponse.json({ error: "sign in as the page owner" }, { status: 403 });
    }
  }

  await removeLink(handle);
  return NextResponse.json({ ok: true });
}
