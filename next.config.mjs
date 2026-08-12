
// ── Security headers ─────────────────────────────────────────────────────────────────────────
// The app shipped with none of these, so a donate page could be framed by any site and covered
// with a decoy button — a click meant for "CLAIM FREE SKINS" landing on the donate form instead
// (verified locally before this was added). Everything below is defence for pages where money
// moves.
//
// Two profiles, because the overlays have the opposite requirement to the rest of the site:
//   • the app          — must NEVER be framed (clickjacking).
//   • /overlay/*       — exists to BE framed, by OBS and Streamlabs Desktop, so it opts out of
//                        the frame ban while keeping the rest.
const CSP_APP = [
  "default-src 'self'",
  // Next injects inline bootstrap scripts and styled-jsx style tags; 'unsafe-inline' is required
  // for those. 'unsafe-eval' stays out of PRODUCTION — nothing shipped needs it.
  //
  // `next dev` is the exception: its hot-reload runtime evaluates code as strings, so the same
  // policy silently kills every client script in dev. The page still renders — server HTML is
  // there — but nothing hydrates, so the landing sat at opacity:0 forever and looked broken.
  // Scoped to NODE_ENV, so the deployed policy is exactly as strict as before.
  process.env.NODE_ENV === "development"
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  // Avatars and page backdrops are user-supplied data: URLs and, for uploads, blobs.
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  // The RPC we read the chain from, the wallet SDKs' relays, Streamlabs — and the
  // IC gateway the browser reads the game canisters through. Anything not listed
  // here cannot be reached from the page, so an injected script has nowhere to
  // send what it takes.
  //
  // The IC host is taken from the same env var the client is built with, because
  // it is not one address: `https://icp-api.io` in production, `http://127.0.0.1:4943`
  // in front of a local replica. Without it the escrow games look configured and
  // are not — the pages show their real-escrow copy and every canister read is
  // refused by the policy, which is the worst of both states and is exactly how
  // a local run behaved.
  ["connect-src 'self'", ...(process.env.NEXT_PUBLIC_IC_HOST ? [process.env.NEXT_PUBLIC_IC_HOST] : []),
    "https://api.devnet.solana.com https://*.solana.com wss://*.solana.com https://*.reown.com wss://*.reown.com https://*.walletconnect.com wss://*.walletconnect.com https://*.walletconnect.org wss://*.walletconnect.org https://streamlabs.com"].join(" "),
  // Wallet extensions and WalletConnect open their own frames for approval.
  "frame-src 'self' https://*.reown.com https://*.walletconnect.com https://*.walletconnect.org",
  "object-src 'none'",
  "base-uri 'self'",
  // Nothing on this site posts a form anywhere but back to itself.
  "form-action 'self'",
  // Blocks framing by any OTHER site — the clickjacking defence — while still allowing our own
  // pages to frame each other, which the cabinet's live preview depends on. 'none' would ban that
  // too and leave the builder's preview blank.
  "frame-ancestors 'self'",
].join("; ");

// Same policy, minus the frame ban: OBS/Streamlabs load these in a Browser Source.
const CSP_OVERLAY = CSP_APP.replace("frame-ancestors 'self'", "frame-ancestors *");

const SECURITY_HEADERS = [
  // Belt and braces with frame-ancestors: some older browsers only understand this one.
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Nothing here uses a camera, a mic or location — say so, so an injected iframe can't either.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  // HSTS is only meaningful over TLS; on plain http (local dev) browsers ignore it anyway.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      // The overlays are meant to be embedded — they must come FIRST, since Next applies the first
      // matching source and a blanket rule above would ban the framing they depend on.
      {
        source: "/overlay/:path*",
        headers: [
          ...SECURITY_HEADERS.filter((h) => h.key !== "X-Frame-Options"),
          { key: "Content-Security-Policy", value: CSP_OVERLAY },
        ],
      },
      {
        // Everything except /overlay/* — Next applies EVERY matching rule, not just the first, so
        // without this exclusion the blanket policy would overwrite the overlay's framing opt-in.
        source: "/((?!overlay/).*)",
        headers: [...SECURITY_HEADERS, { key: "Content-Security-Policy", value: CSP_APP }],
      },
    ];
  },
  // Nothing gains from advertising the framework version.
  poweredByHeader: false,
  distDir: process.env.NEXT_DIST_DIR || ".next",
  experimental: {
    // instrumentation.ts starts the devnet indexer inside the server process
    // (one loop, no separate worker to babysit).
    instrumentationHook: true,
    // Native/server-only packages must not be bundled by webpack — loaded at
    // runtime from node_modules instead (libsql ships prebuilt .node binaries).
    serverComponentsExternalPackages: ["@libsql/client", "libsql"],
  },
  webpack: (config, { nextRuntime }) => {
    // Опциональная зависимость @metamask/sdk, не нужная в вебе (только RN).
    config.resolve.alias = {
      ...config.resolve.alias,
      "@react-native-async-storage/async-storage": false,
    };
    config.externals.push("pino-pretty", "lokijs", "encoding");
    // instrumentation.ts is compiled for the edge runtime too, where node
    // builtins don't exist. Its server work (indexer, backup, DB) runs only
    // under the node runtime (NEXT_RUNTIME guard), so stub the builtins out of
    // the non-node bundle instead of letting the resolver fail on `fs`.
    if (nextRuntime !== "nodejs") {
      config.resolve.fallback = { ...config.resolve.fallback, fs: false, path: false, os: false, net: false, tls: false, crypto: false };
    }
    return config;
  },
};

export default nextConfig;
