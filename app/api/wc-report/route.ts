import { NextResponse } from "next/server";
import { readStore, writeStore, queueAdmin } from "@/lib/server/telegram-store";

// Browser-callable WalletConnect health report. When a viewer's WalletConnect attempt fails (init or
// connect), the client fires this so the founders get a heads-up in Telegram to fix it. Unlike
// /notify-admin (server-to-server, secret-gated), this MUST be callable from the browser — so it
// carries no secret and instead is locked down two ways:
//   • it can ONLY ever send one fixed alert (a WalletConnect-down card) — no attacker-controlled text
//     reaches the founder channel, so a forged call can't spam arbitrary content;
//   • it's throttled server-side to one alert per cooldown window, so it can't flood the channel.
// Fail-open on errors: reporting must never throw back into the connect UI.

// One alert per this window across ALL callers (module-level, per server instance) — enough to warn
// the team once without a storm when many viewers hit the same outage.
const COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes
let lastSentAt = 0;

export async function POST(req: Request) {
  try {
    const now = Date.now();
    if (now - lastSentAt < COOLDOWN_MS) {
      // Already warned recently — acknowledge without re-queuing.
      return NextResponse.json({ ok: true, throttled: true });
    }

    // The only caller-supplied field we accept is a short, sanitised context string (which wallet /
    // page), never free-form content that becomes the card body verbatim.
    const { context } = (await req.json().catch(() => ({}))) as { context?: string };
    const safeContext = typeof context === "string" ? context.replace(/[^\w .:/@-]/g, "").slice(0, 120) : "";

    const s = await readStore();
    if (s.founders.length === 0) {
      // Nobody to notify (no founder linked yet) — nothing to do, but not an error.
      return NextResponse.json({ ok: true, founders: 0 });
    }

    const sent = await queueAdmin(s, {
      label: "WalletConnect",
      title: "WalletConnect is failing",
      body: safeContext
        ? `A viewer couldn't connect via WalletConnect (${safeContext}). Phantom/Solflare still work. Worth a look.`
        : "A viewer couldn't connect via WalletConnect. Phantom/Solflare still work. Worth a look.",
      value: "down",
    });
    if (sent > 0) {
      await writeStore(s);
      lastSentAt = now;
    }
    return NextResponse.json({ ok: true, founders: sent });
  } catch {
    // Never surface an error to the client — a failed report must not break the connect flow.
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
