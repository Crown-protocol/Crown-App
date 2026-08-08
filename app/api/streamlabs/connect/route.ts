import { NextRequest, NextResponse } from "next/server";
import { streamlabsConfigured, signState } from "@/lib/server/streamlabs";
import { readSession } from "@/lib/server/session";
import { getProfileOwner } from "@/lib/server/store";
import { allow } from "@/lib/server/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUTHORIZE_URL = "https://streamlabs.com/api/v2.0/authorize";
// Only what we actually use: create a donation (which fires their alert). Asking for more than we
// need is how integrations end up holding rights nobody agreed to.
const SCOPES = "donations.create";

// Step 1 of connecting a Streamlabs account: send the streamer to Streamlabs to approve.
// The `state` carries the handle we're linking AND a signature over it, so the callback can trust
// which page it is completing — an attacker must not be able to point someone's approval at a page
// they don't own.
export async function GET(req: NextRequest) {
  if (!allow(req, "sl-connect", 10, 10)) return NextResponse.json({ error: "slow down" }, { status: 429 });
  if (!streamlabsConfigured()) {
    return NextResponse.json({ error: "Streamlabs integration isn't configured on this server" }, { status: 503 });
  }

  const handle = (new URL(req.url).searchParams.get("handle") ?? "").replace(/^@/, "").trim().toLowerCase();
  if (!handle) return NextResponse.json({ error: "handle required" }, { status: 400 });

  // Only the page's owner may connect it. An owned page needs the editing session cookie the
  // wallet signature issued; a demo page (no owner) is open, like the rest of demo mode.
  const owner = await getProfileOwner(handle);
  if (owner) {
    const signer = readSession(req);
    if (!signer || signer !== owner) {
      return NextResponse.json({ error: "sign in as the page owner to connect Streamlabs" }, { status: 403 });
    }
  }

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", process.env.STREAMLABS_CLIENT_ID!);
  url.searchParams.set("redirect_uri", process.env.STREAMLABS_REDIRECT_URI!);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES);
  // Signed, so the callback can prove this approval is the one we sent — not a link someone else
  // crafted naming a page they don't own.
  const state = signState(handle);
  if (!state) return NextResponse.json({ error: "server is missing CHEER_SESSION_SECRET" }, { status: 503 });
  url.searchParams.set("state", state);

  return NextResponse.redirect(url.toString());
}
