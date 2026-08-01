"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useProfile } from "@/lib/data/ProfileProvider";
import { useIsOwner } from "@/lib/data/useIsOwner";
import { useSignedIn } from "@/lib/data/useSignedIn";
import { useCtaHandoff } from "@/lib/data/ctaHandoff";
import { AuthButton } from "./AuthButton";
import { Mono } from "./Mono";

// The owner-only Admin entry — a quiet pill that appears in the top bar ONLY when the connected
// wallet is the platform owner's. Everyone else (anonymous visitors, ordinary streamers) never
// renders it. The /admin route's real access gate is server-side; this just hides the door.
function AdminPill() {
  const isOwner = useIsOwner();
  if (!isOwner) return null;
  return (
    <Link className="admin-pill" href="/admin" title="Admin panel">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 3l7 3v5c0 4.3-2.9 7.6-7 8.7C7.9 18.6 5 15.3 5 11V6l7-3Z" />
        <path d="M9.2 12l2 2 3.6-3.8" />
      </svg>
      Admin
    </Link>
  );
}

// Right corner of the top bar. Two states:
//   • signed out → "Create or log in" — opens the wallet modal (AuthButton), then routes itself:
//     an existing account (found by wallet owner) logs in, a new wallet lands on registration.
//   • signed in  → avatar + "Personal space".
// Log out forgets this device (profile + ownership proof cleared), so signing back in reconnects the
// wallet and asks for the one-time ownership signature again.
// The owner also gets an Admin pill, before either — see AdminPill (wallet-gated).
export function TopRight() {
  const { ready, profile } = useProfile();
  const signedIn = useSignedIn();
  const pathname = usePathname();
  // True while the landing page's closing CTA is in view (false on every other page). Declared
  // before any early return — hooks must run on every render.
  const handedOff = useCtaHandoff();
  if (!ready) return <span style={{ display: "inline-block", width: 150 }} aria-hidden />;

  const admin = <AdminPill />;

  if (!signedIn) {
    // Already on the registration page — a "Create or log in" button pointing at the flow
    // you're standing in is just noise. The admin pill (wallet-gated) may still show.
    if (pathname === "/create") return <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>{admin}</div>;
    // One entry for everyone signed out: the button asks for a wallet, then routes itself — an
    // existing account (found by wallet owner) logs straight in, a new wallet lands on registration.
    // No middle "create your page first" page, and no separate create-vs-login split to get wrong.
    return (
      <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
        {admin}
        {/* Retracts up into the bar while the landing page's own big CTA is on screen — the two
            are the same offer, and showing both at once splits the click. See ctaHandoff.ts. */}
        <span className={`cta-handoff${handedOff ? " away" : ""}`}>
          <AuthButton label="Create or log in" style={{ height: 44, fontSize: 15 }} />
        </span>
      </div>
    );
  }

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      {admin}
      <span className={`cta-handoff${handedOff ? " away" : ""}`}>
        <Link className="persona" href="/space">
          Personal space
          <Mono name={profile?.name || "?"} size={32} src={profile?.avatarUrl} />
        </Link>
      </span>
    </div>
  );
}
