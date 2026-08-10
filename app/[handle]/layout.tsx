import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getProfile } from "@/lib/server/store";
import { resolveMaker, makerMetadata } from "@/lib/server/publicMeta";

export const dynamic = "force-dynamic";

// Share card for the maker's main donation page (and the fallback for any child without its own —
// e.g. a campaign /@handle/<slug>). The game pages override this with their own kind below.
export async function generateMetadata({ params }: { params: { handle: string } }): Promise<Metadata> {
  const maker = await resolveMaker(params.handle);
  return maker ? makerMetadata(maker, "page") : {};
}

// Server-side existence gate for the whole /@handle subtree — the streamer page AND every child
// (task / roulette / fundraiser / campaign slug). If the handle isn't registered,
// streamer and isn't a saved page in the DB, this returns a REAL 404 (not a 200 stand-in screen),
// so a bogus /@whatever is a proper 404 for search engines and correctness. Real pages are always
// server-saved (ProfileProvider posts every profile), so a legitimate page never 404s here.
export default async function HandleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { handle: string };
}) {
  const handle = decodeURIComponent(params.handle).replace(/^@/, "").toLowerCase();
  const exists = !!(await getProfile(handle));
  if (!exists) notFound();
  return <>{children}</>;
}
