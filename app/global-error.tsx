"use client";

import { useEffect } from "react";

// Last-resort boundary: catches an error thrown by the ROOT layout itself (where app/error.tsx can't
// reach). It REPLACES the root layout, so it must render its own <html>/<body> — and the app's CSS may
// not have loaded, so everything here is inlined and on-brand (deep violet, one purple accent).
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#100f16",
          color: "#F1EFF7",
          fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          padding: "24px",
        }}
      >
        <div style={{ maxWidth: "440px", textAlign: "center" }}>
          {/* the Cheer mark, drawn minimally so this page needs no assets */}
          <div style={{ width: "44px", height: "44px", borderRadius: "12px", background: "#8B7CF6", margin: "0 auto 20px" }} />
          <h1 style={{ fontSize: "26px", fontWeight: 700, margin: "0 0 10px", letterSpacing: "-0.01em" }}>Something went wrong</h1>
          <p style={{ color: "#A7A2BC", lineHeight: 1.5, margin: "0 0 22px" }}>
            A hiccup on our side — not you. Reload the page, and if it keeps happening, try again in a moment.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              height: "48px",
              padding: "0 24px",
              borderRadius: "999px",
              border: "none",
              background: "#8B7CF6",
              color: "#151320",
              fontSize: "16px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
          {error.digest && <p style={{ marginTop: "16px", fontSize: "12px", color: "#6E6A82" }}>Reference: {error.digest}</p>}
        </div>
      </body>
    </html>
  );
}
