"use client";

import { useEffect, useMemo, useState } from "react";
import { useCheer } from "./DataProvider";
import { MOCK_STREAMERS } from "./mock";
import { tierInfo } from "@/lib/level";
import type { Profile, Streamer, Tier } from "./types";

export interface MyMaker {
  handle: string;
  name: string;
  avatarUrl?: string;
  avatarEnabled?: boolean;
  tiers: Tier[];
  rep: number;
  /** The tier held with this maker right now (null below the first threshold). */
  current: Tier | null;
  /** The next tier up, or null at the top of the ladder. */
  next: Tier | null;
  /** Progress through the CURRENT tier band, 0–100. */
  pct: number;
}

export interface MyReputation {
  makers: MyMaker[];
  total: number;
  /** The maker you hold the most points with — the page's headline standing. */
  top: MyMaker | null;
  /** The highest tier held anywhere, by threshold. */
  bestTier: Tier | null;
  /** Reputation with one specific maker, for the badge on their page. */
  forHandle: (handle: string) => MyMaker | null;
}

// One place that answers "where does this viewer stand" — used by the wallet menu, the reputation
// page and the per-maker badge, so the three can never disagree. Reputation itself still comes from
// useCheer().getReputation (mock map or chain mirror); this only resolves the makers and the ladders.
export function useMyReputation(): MyReputation {
  const { getReputation } = useCheer();
  const [known, setKnown] = useState<Omit<MyMaker, "rep" | "current" | "next" | "pct">[]>([]);

  useEffect(() => {
    let dead = false;
    void (async () => {
      const base: Record<string, Omit<MyMaker, "rep" | "current" | "next" | "pct">> = {};
      for (const s of Object.values(MOCK_STREAMERS) as Streamer[]) {
        base[s.handle.toLowerCase()] = { handle: s.handle, name: s.name, avatarUrl: s.avatarUrl, avatarEnabled: s.avatarEnabled, tiers: s.tiers };
      }
      try {
        // ?avatars=1 — the reputation page shows each maker's face beside their ladder.
        const r = await fetch("/api/profiles?avatars=1");
        if (r.ok) {
          const { profiles } = (await r.json()) as { profiles: Profile[] };
          for (const p of profiles ?? []) {
            base[p.handle.toLowerCase()] = { handle: p.handle, name: p.name, avatarUrl: p.avatarUrl, avatarEnabled: p.avatarEnabled, tiers: p.tiers };
          }
        }
      } catch {}
      if (!dead) setKnown(Object.values(base));
    })();
    return () => {
      dead = true;
    };
  }, []);

  return useMemo(() => {
    const makers: MyMaker[] = known
      .map((m) => {
        const rep = getReputation(m.handle);
        const { current, next } = tierInfo(rep, m.tiers);
        const from = current?.threshold ?? 0;
        const pct = next ? Math.min(100, Math.max(0, Math.round(((rep - from) / Math.max(1, next.threshold - from)) * 100))) : 100;
        return { ...m, rep, current, next, pct };
      })
      .filter((m) => m.rep > 0)
      .sort((a, b) => b.rep - a.rep);

    const total = makers.reduce((s, m) => s + m.rep, 0);
    const bestTier =
      makers
        .map((m) => m.current)
        .filter((t): t is Tier => !!t)
        .sort((a, b) => b.threshold - a.threshold)[0] ?? null;

    return {
      makers,
      total,
      top: makers[0] ?? null,
      bestTier,
      forHandle: (handle: string) => makers.find((m) => m.handle.toLowerCase() === handle.toLowerCase()) ?? null,
    };
  }, [known, getReputation]);
}
