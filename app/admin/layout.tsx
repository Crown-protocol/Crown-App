import type { Metadata } from "next";

// The admin is a private, wallet-gated area — keep it out of search indexes (a crawler only ever sees
// the gate anyway). The public marketing/creator pages stay indexable via the root robots default.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
