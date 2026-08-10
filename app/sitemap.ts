import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";
import { listProfiles } from "@/lib/server/store";

export const dynamic = "force-dynamic";

// Every page worth finding in a search engine: the marketing surfaces, plus one entry per creator
// page and its four mini-games.
//
// Built from the database rather than a hand-kept list, so a creator who registers today is
// findable without anyone remembering to edit this file. Only what robots.ts allows appears here —
// the cabinet, the admin panel and the overlays are deliberately absent.
const STATIC: { path: string; priority: number; freq: MetadataRoute.Sitemap[number]["changeFrequency"] }[] = [
  { path: "", priority: 1, freq: "weekly" },
  { path: "/discover", priority: 0.9, freq: "daily" },
  { path: "/games", priority: 0.8, freq: "weekly" },
  { path: "/docs", priority: 0.5, freq: "monthly" },
  { path: "/wallet-guide", priority: 0.5, freq: "monthly" },
  { path: "/terms", priority: 0.3, freq: "yearly" },
  { path: "/privacy", priority: 0.3, freq: "yearly" },
];

const GAMES = ["task", "roulette", "fundraiser"] as const;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const out: MetadataRoute.Sitemap = STATIC.map((s) => ({
    url: `${SITE_URL}${s.path}`,
    lastModified: now,
    changeFrequency: s.freq,
    priority: s.priority,
  }));

  // A database that can't be read must not take the whole sitemap down with it — better a partial
  // sitemap of the static pages than a 500 that tells the crawler nothing at all.
  try {
    const profiles = await listProfiles();
    for (const p of profiles) {
      if (!p?.handle) continue;
      const base = `${SITE_URL}/@${encodeURIComponent(p.handle)}`;
      out.push({ url: base, lastModified: now, changeFrequency: "daily", priority: 0.8 });
      for (const g of GAMES) {
        out.push({ url: `${base}/${g}`, lastModified: now, changeFrequency: "daily", priority: 0.6 });
      }
    }
  } catch {
    // static entries above still ship
  }

  return out;
}
