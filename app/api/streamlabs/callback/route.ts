import { NextRequest, NextResponse } from "next/server";
import { exchangeCode, readState, saveLink, streamlabsConfigured } from "@/lib/server/streamlabs";
import { allow } from "@/lib/server/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Step 2: Streamlabs sends the streamer back here with a code. We swap it for tokens and store the
// link, then bounce them into the cabinet with a plain result in the URL so the UI can say what
// happened. Tokens themselves never touch the browser — they live server-side only.
export async function GET(req: NextRequest) {
  if (!allow(req, "sl-callback", 10, 10)) return NextResponse.json({ error: "slow down" }, { status: 429 });

  const { searchParams, origin } = new URL(req.url);
  const back = (status: string) => NextResponse.redirect(`${origin}/space?streamlabs=${status}`);

  if (!streamlabsConfigured()) return back("unconfigured");

  // The streamer pressed "Deny" on Streamlabs' consent screen — a normal outcome, not an error.
  if (searchParams.get("error")) return back("denied");

  const code = searchParams.get("code");
  const state = searchParams.get("state");
  if (!code || !state) return back("failed");

  // Which page this approval was for. Signed at /connect, so a forged state can't attach someone's
  // Streamlabs account to a page they don't own.
  const handle = readState(state);
  if (!handle) return back("failed");

  const tokens = await exchangeCode(code);
  if (!tokens) return back("failed");

  await saveLink({
    handle,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
  });

  return back("connected");
}
