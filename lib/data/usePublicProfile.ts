"use client";

import { useEffect, useState } from "react";
import { useProfile } from "./ProfileProvider";
import { MOCK_STREAMERS } from "./mock";
import type { Profile } from "./types";

// Resolve the FULL profile behind a public game page (/@handle/task|roulette|fundraiser|auction)
// by handle — so a viewer who opens the link or QR in ANY browser gets the content maker's page,
// not the owner-only gate. The game pages need the whole Profile (headline, presets, per-game
// config), not the trimmed Streamer that DataProvider.getStreamer returns, so this resolves it
// straight from the Cheer DB.
//
// Order of truth:
//   1. your own local profile — if this is YOUR page, the cabinet copy is the freshest;
//   2. the Cheer DB (/api/profiles/<handle>) — the server copy every browser resolves against;
//   3. a built-in demo streamer (MOCK_STREAMERS) — so /@nova/* always demos, even with no DB row.
// `profile` is null only when the handle exists nowhere; `status` is "loading" until resolved so
// the page shows a blank frame instead of flashing the "nothing here" gate mid-fetch.
export function usePublicProfile(handle: string): { profile: Profile | null; status: "loading" | "ready" } {
  const { ready, profile: local } = useProfile();
  const key = handle.replace(/^@/, "").toLowerCase();
  const [resolved, setResolved] = useState<Profile | null>(null);
  const [status, setStatus] = useState<"loading" | "ready">("loading");

  useEffect(() => {
    if (!ready) {
      setStatus("loading");
      return;
    }
    // Your own page: the cabinet's localStorage copy is fresher than the server's.
    if (local && local.handle.toLowerCase() === key) {
      setResolved(local);
      setStatus("ready");
      return;
    }
    // Built-in demo streamers are reserved seed handles (/@nova/*) — resolve them directly, with
    // no network round-trip, so the "See an example" flow is instant and the console stays clean
    // (no 404 for a handle that was never meant to live in the DB). A Streamer has every field
    // Profile requires; the per-game defaults (withXDefaults) fill the rest.
    const demo = MOCK_STREAMERS[key];
    if (demo) {
      setResolved({ ...demo });
      setStatus("ready");
      return;
    }
    let dead = false;
    setStatus("loading");
    void (async () => {
      try {
        const r = await fetch(`/api/profiles/${encodeURIComponent(key)}`);
        if (!dead && r.ok) {
          const { profile: p } = (await r.json()) as { profile: Profile };
          if (!dead && p) {
            setResolved(p);
            setStatus("ready");
            return;
          }
        }
      } catch {
        // network error — the page falls through to its "nothing here" gate below
      }
      if (dead) return;
      // Handle exists nowhere (bad link) — let the page show its own "nothing here" note.
      setResolved(null);
      setStatus("ready");
    })();
    return () => {
      dead = true;
    };
  }, [ready, key, local]);

  return { profile: resolved, status };
}
