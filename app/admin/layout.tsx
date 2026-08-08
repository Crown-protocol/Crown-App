import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/server/session";
import { OWNER_ADDRESS } from "@/lib/data/session";

// The admin panel is platform-owner only. Its APIs always checked the caller (403 for everyone
// else), but the PAGE itself rendered for anyone who typed the URL — so a stranger got a full
// dashboard of demo figures ($720,635 and friends) presented as the platform's revenue. No real
// data leaked, since every number on that first paint is mock, but a public page quoting invented
// earnings is its own kind of damage.
//
// Gated here rather than in middleware: this is the only private surface in the app, and a layout
// keeps the check next to the thing it protects instead of in a file nobody opens.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

// Never prerender: the answer depends on the caller's cookie.
export const dynamic = "force-dynamic";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const owner = verifySessionToken(cookies().get(SESSION_COOKIE)?.value);
  // 404 rather than 403: a "forbidden" page confirms the panel exists at this path. Someone who
  // isn't the owner has no business learning that either way.
  if (owner !== OWNER_ADDRESS) notFound();
  return children;
}
