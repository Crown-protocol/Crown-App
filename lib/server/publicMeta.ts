import type { Metadata } from "next";
import { getProfile } from "@/lib/server/store";
import { MOCK_STREAMERS } from "@/lib/data/mock";

// Everything the public share cards need to know about a content maker, resolved server-side so
// generateMetadata (and the OG image route) can run before any client JS. Built-in demo streamers
// live in code (MOCK_STREAMERS); real pages live in the DB — check both, DB first.
export type MetaKind = "page" | "task" | "roulette" | "fundraiser" | "auction";

export interface PublicMaker {
  handle: string;
  name: string;
  avatarUrl?: string;
}

export async function resolveMaker(handleRaw: string): Promise<PublicMaker | null> {
  const handle = decodeURIComponent(handleRaw).replace(/^@/, "").toLowerCase();
  const db = await getProfile(handle).catch(() => null);
  const m = db ?? MOCK_STREAMERS[handle];
  if (!m) return null;
  // Owner can hide the avatar; honour that in the share card too.
  const avatarUrl = m.avatarEnabled === false ? undefined : m.avatarUrl;
  return { handle, name: (m.name || handle).trim() || handle, avatarUrl };
}

const KIND_TITLE: Record<MetaKind, string> = {
  page: "",
  task: "Set a task",
  roulette: "Game roulette",
  fundraiser: "Fundraiser",
  auction: "Auction",
};

// Since profile bios are gone, this generated line IS the share description — one sentence per surface.
const KIND_DESC: Record<MetaKind, (n: string) => string> = {
  page: (n) => `Support ${n} on Crown — donations land straight in their wallet, and every dollar builds your reputation with them.`,
  task: (n) => `Set ${n} a paid task on Crown. They do it, or you're refunded automatically.`,
  roulette: (n) => `Back what ${n} plays next — donate toward a pick and the wheel decides. On Crown.`,
  fundraiser: (n) => `Chip in to ${n}'s goal on Crown — refunded in full if it isn't delivered.`,
  auction: (n) => `Bid for ${n}'s time on Crown — outbid the board; the winner pays only once it's delivered.`,
};

// One page's worth of share metadata: title, the generated description, canonical URL, and the
// OpenGraph + Twitter cards, both pointing at the dynamic /api/og image for this maker (and kind).
export function makerMetadata(maker: PublicMaker, kind: MetaKind, pathSuffix = ""): Metadata {
  const title = kind === "page" ? `${maker.name} (@${maker.handle})` : `${maker.name} · ${KIND_TITLE[kind]}`;
  const description = KIND_DESC[kind](maker.name);
  const ogUrl = `/api/og?handle=${encodeURIComponent(maker.handle)}${kind !== "page" ? `&kind=${kind}` : ""}`;
  const path = `/@${maker.handle}${pathSuffix}`;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: "Crown",
      url: path,
      title,
      description,
      images: [{ url: ogUrl, width: 1200, height: 630, alt: `${maker.name} on Crown` }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogUrl],
    },
  };
}
