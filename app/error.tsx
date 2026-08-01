"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Logo } from "@/components/Logo";

// Route-level error boundary: any uncaught error while rendering a page (under the root layout) lands
// here instead of a blank screen. It renders inside the root layout, so the app's chrome and styles
// are available — same shell as not-found.tsx. `reset()` re-attempts the failed render.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Surface it for whatever monitoring is wired up; `digest` ties a user's report to a server log line.
    console.error(error);
  }, [error]);

  return (
    <main className="page">
      <header className="appbar">
        <Logo />
      </header>
      <div className="center-note">
        <h1>Something went wrong</h1>
        <p>A hiccup on our side — not you. Try again, and if it keeps happening, head back home.</p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <button className="btn" type="button" onClick={reset}>
            Try again
          </button>
          <Link className="btn-outline" href="/">
            Back to home
          </Link>
        </div>
        {error.digest && (
          <p className="footnote" style={{ marginTop: 12 }}>
            Reference: {error.digest}
          </p>
        )}
      </div>
    </main>
  );
}
