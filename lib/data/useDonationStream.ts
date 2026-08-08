"use client";

import { useEffect, useRef } from "react";
import { subscribeDonations, startDemo, type DonationEvent } from "./donationStream";

// Subscribe an overlay to its streamer's live donations.
//
// TWO transports, on purpose:
//   • SSE from /api/donations/stream — the real one. OBS's Browser Source is its own browser, so
//     anything in-browser (BroadcastChannel below) never reaches it; the server push does. This is
//     what makes a donation actually appear on stream.
//   • BroadcastChannel — kept for the same-browser cases the server can't serve: the cabinet's
//     "Test" button and mock-mode donations, neither of which ever touch the indexer's book.
//
// Both feed the same callback, and duplicates are filtered by signature, so a donation that
// arrives twice (fired locally, then mirrored by the indexer) shows once.
//
// `demo` fabricates donations on a timer so an overlay is lively in OBS without a real donor.
export function useDonationStream(handle: string, cb: (e: DonationEvent) => void, demo = false): void {
  const cbRef = useRef(cb);
  cbRef.current = cb;

  useEffect(() => {
    // Signatures already delivered, so the two transports can't double-fire one donation.
    const seen = new Set<string>();
    const deliver = (e: DonationEvent & { signature?: string }) => {
      if (e.signature) {
        if (seen.has(e.signature)) return;
        seen.add(e.signature);
        // A stream runs for hours; forget the oldest key rather than grow without bound.
        if (seen.size > 300) seen.delete(seen.values().next().value as string);
      }
      cbRef.current(e);
    };

    const unsub = subscribeDonations(handle, deliver);
    const stopDemo = demo ? startDemo(handle) : undefined;

    // A demo overlay fabricates its own events — connecting to the real book as well would mix
    // invented donations with genuine ones on screen.
    let es: EventSource | null = null;
    if (handle && !demo && typeof EventSource !== "undefined") {
      try {
        es = new EventSource(`/api/donations/stream?handle=${encodeURIComponent(handle)}`);
        es.addEventListener("donation", (ev) => {
          try {
            const d = JSON.parse((ev as MessageEvent).data) as DonationEvent & { signature?: string };
            deliver({ ...d, handle });
          } catch {
            // a malformed frame must not take the overlay down mid-stream
          }
        });
        // EventSource reconnects by itself after a drop; nothing to do here but not crash.
        es.onerror = () => {};
      } catch {
        es = null;
      }
    }

    return () => {
      unsub();
      stopDemo?.();
      es?.close();
    };
  }, [handle, demo]);
}
