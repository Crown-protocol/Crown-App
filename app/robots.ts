import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// What crawlers may index. The rule of thumb: a page a stranger could usefully land on from a
// search result is allowed; anything that only makes sense while signed in, or that belongs to one
// person, is not.
//
// Disallow here is a request, not a lock — it keeps private surfaces out of search results, it does
// not protect them. The cabinet and the admin panel are gated server-side regardless.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/", // no crawlable content, and some routes are rate-limited
          "/space", // the creator's own cabinet
          "/space/",
          "/admin", // platform owner only
          "/create", // registration flow — nothing to index, and it reads as a duplicate of the landing
          "/me", // a visitor's own reputation page
          "/overlay", // OBS overlays: transparent widgets meant for a stream, not a reader
          "/overlay/",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
