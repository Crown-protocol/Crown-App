"use client";

import { useEffect, useState } from "react";

// True when the viewport is desktop-width. Used by the public game pages to pick the desktop photo
// of a "split" background. Inside the builder's LivePreview the page runs in an iframe sized to the
// device, so this reflects the PREVIEWED device — the split preview is faithful with no extra work.
export function useIsWide(query = "(min-width: 768px)"): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const sync = () => setWide(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [query]);
  return wide;
}
