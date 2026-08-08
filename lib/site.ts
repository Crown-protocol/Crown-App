// The site's own public address, in one place.
//
// It was inlined in app/layout.tsx for OpenGraph, and robots/sitemap need the same value — three
// copies of a fallback domain is how one of them ends up pointing at the wrong host after a rename.
//
// NEXT_PUBLIC_SITE_URL is the deployment's real origin (https://… in production). The fallback is
// only for a local build; a sitemap generated with it would list localhost URLs, which is why the
// production deploy MUST set the variable.
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://cheer.tv").replace(/\/+$/, "");
