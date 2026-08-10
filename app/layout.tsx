import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  // Absolute base for OpenGraph/Twitter image URLs (crawlers need absolute). Set NEXT_PUBLIC_SITE_URL
  // to the real domain in production; falls back to the documented cheer.tv default.
  metadataBase: new URL(SITE_URL),
  applicationName: "Cheer",
  title: {
    default: "Cheer — donations straight to your wallet",
    // Child pages set a plain title (e.g. "Nova (@nova)"); this frames it → "Nova (@nova) · Cheer".
    template: "%s · Cheer",
  },
  description:
    "Cheer turns donations into on-chain support: money lands straight in the creator's wallet, and every dollar builds the viewer's reputation with them. Set a paid task, spin a game roulette, or raise a goal — refunds are automatic when a promise isn't kept.",
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
    "game roulette",
    "viewer reputation",
    "Cheer",
  ],
  authors: [{ name: "Cheer" }],
  creator: "Cheer",
  publisher: "Cheer",
  category: "technology",
  formatDetection: { telephone: false, address: false, email: false },
  robots: { index: true, follow: true },
  appleWebApp: { capable: true, title: "Cheer", statusBarStyle: "black-translucent" },
  openGraph: {
    type: "website",
    siteName: "Cheer",
    title: "Cheer — donations straight to your wallet",
    description: "Donations straight to your wallet. Every dollar builds a viewer's reputation with the creator.",
    // The branded default share card for the landing and any page without its own (maker pages override).
    images: [{ url: "/api/og", width: 1200, height: 630, alt: "Cheer" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Cheer — donations straight to your wallet",
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
