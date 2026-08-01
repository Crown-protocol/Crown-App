import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  // Absolute base for OpenGraph/Twitter image URLs (crawlers need absolute). Set NEXT_PUBLIC_SITE_URL
  // to the real domain in production; falls back to the documented crown.tv default.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://crown.tv"),
  applicationName: "Crown",
  title: {
    default: "Crown — donations straight to your wallet",
    // Child pages set a plain title (e.g. "Nova (@nova)"); this frames it → "Nova (@nova) · Crown".
    template: "%s · Crown",
  },
  description:
    "Crown turns donations into on-chain support: money lands straight in the creator's wallet, and every dollar builds the viewer's reputation with them. Set a paid task, spin a game roulette, raise a goal, or auction your time — refunds are automatic when a promise isn't kept.",
  keywords: [
    "creator donations",
    "streamer donations",
    "tips",
    "crypto donations",
    "Solana",
    "USDC",
    "on-chain tips",
    "donation page",
    "creator monetization",
    "task for donation",
    "fundraiser",
    "auction",
    "game roulette",
    "viewer reputation",
    "Crown",
  ],
  authors: [{ name: "Crown" }],
  creator: "Crown",
  publisher: "Crown",
  category: "technology",
  formatDetection: { telephone: false, address: false, email: false },
  robots: { index: true, follow: true },
  appleWebApp: { capable: true, title: "Crown", statusBarStyle: "black-translucent" },
  openGraph: {
    type: "website",
    siteName: "Crown",
    title: "Crown — donations straight to your wallet",
    description: "Donations straight to your wallet. Every dollar builds a viewer's reputation with the creator.",
    // The branded default share card for the landing and any page without its own (maker pages override).
    images: [{ url: "/api/og", width: 1200, height: 630, alt: "Crown" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Crown — donations straight to your wallet",
    description: "Donations straight to your wallet.",
    images: ["/api/og"],
  },
};

// Without this, mobile browsers render the page at a ~980px desktop width and zoom out — every
// screen arrives tiny. width=device-width makes the layout use the real device width; viewport-fit
// lets safe-area insets (notch / home indicator) work. Zoom stays enabled (accessibility).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#100f16",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
