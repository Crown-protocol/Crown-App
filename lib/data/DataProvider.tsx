"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { isSplitterConfigured, isIndexConfigured, isValidAddress, USDC_DECIMALS } from "@/lib/chain/config";
import { buildDonateTx } from "@/lib/chain/splitter";
import { toMinorUnits } from "@/lib/chain/solana";
import { fetchReputation, ingestHint } from "@/lib/chain/icp";
import { useSolanaWallet } from "@/lib/chain/wallet";
import type { DataMode, Donation, DonateInput, Streamer, Campaign } from "./types";
import { MOCK_STREAMERS, MOCK_FEED, MOCK_REPUTATION, MOCK_CAMPAIGNS } from "./mock";
import { publishDonation } from "./donationStream";
import { useProfile } from "./ProfileProvider";

export class NotConfiguredError extends Error {
  constructor() {
    super("The splitter program isn't configured for this network yet. Ask the backend dev and set it in lib/chain/config.ts.");
    this.name = "NotConfiguredError";
  }
}

interface CrownCtx {
  mode: DataMode;
  setMode: (m: DataMode) => void;
  ready: boolean;
  getStreamer: (handle: string) => Streamer | undefined;
  getCampaign: (handle: string, slug: string) => Campaign | undefined;
  feed: Donation[];
  // Reputation is per-streamer, keyed by handle — never a single global number (front.md §4).
  getReputation: (handle: string) => number;
  lastGainFor: (handle: string) => number | null;
  // Send a donation. In mock — a simulation with "Sending…". In chain — a real
  // Solana devnet transaction through the Crown-Core splitter.
  donate: (input: DonateInput, walletAddress?: string) => Promise<{ txHash?: string }>;
  // Record settled game money instantly (no "Sending…" simulation): feed + reputation + overlays.
  // Mock-only — the chain path settles through the escrow, and the indexer writes the book.
  applyMockDonation: (input: DonateInput) => void;
}

const Ctx = createContext<CrownCtx | null>(null);

// Release knob: NEXT_PUBLIC_DEFAULT_MODE=chain flips fresh visitors to real
// data; unset keeps the mock demo. A visitor's own toggle always wins.
const DEFAULT_MODE: DataMode = process.env.NEXT_PUBLIC_DEFAULT_MODE === "chain" ? "chain" : "mock";

export function DataProvider({ children }: { children: React.ReactNode }) {
  const { profile } = useProfile();
  const wallet = useSolanaWallet();
  const [mode, setModeState] = useState<DataMode>(DEFAULT_MODE);
  const [ready, setReady] = useState(false);

  // Mock state (lives in session memory; the chain path replaces pieces of it
  // as the backend surfaces come online — see the chainRep overlay below).
  const [feed, setFeed] = useState<Donation[]>(MOCK_FEED);
  // Per-streamer reputation: { handle → points }. The viewer earns reputation with each streamer
  // separately; there is no global number.
  const [reputation, setReputation] = useState<Record<string, number>>(MOCK_REPUTATION);
  // Chain-mode overlay: the same shape, but read from the crown-index book
  // (ICP). Only populated when the canister is configured AND a wallet is
  // connected — until the backend dev hands over a principal this stays empty
  // and mock values show, so nothing on screen ever goes blank.
  const [chainRep, setChainRep] = useState<Record<string, number>>({});
  const [campaigns, setCampaigns] = useState<Record<string, Campaign>>(MOCK_CAMPAIGNS);
  const [lastGain, setLastGain] = useState<{ handle: string; amount: number } | null>(null);

  useEffect(() => {
    const saved = typeof window !== "undefined" ? (localStorage.getItem("crown-mode") as DataMode | null) : null;
    if (saved === "mock" || saved === "chain") setModeState(saved);
    setReady(true);
  }, []);

  const setMode = useCallback((m: DataMode) => {
    setModeState(m);
    try {
      localStorage.setItem("crown-mode", m);
    } catch {}
  }, []);

  // Pages registered on the server (the Crown DB) — so a public /@handle
  // resolves in ANY browser, not just the one that created it. Loaded once
  // per session; the local profile still wins for your own page (fresher).
  const [serverPages, setServerPages] = useState<Record<string, Streamer>>({});
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const r = await fetch("/api/profiles");
        if (!r.ok) return;
        const { profiles } = (await r.json()) as { profiles: (Streamer & { handle: string })[] };
        if (dead || !Array.isArray(profiles)) return;
        const map: Record<string, Streamer> = {};
        for (const p of profiles) map[p.handle.toLowerCase()] = p;
        setServerPages(map);
      } catch {}
    })();
    return () => {
      dead = true;
    };
  }, []);

  // Your own page (saved via /create or the page builder) resolves here too, not just the
  // built-in demo streamers — otherwise a real streamer's own /@handle link 404s.
  const getStreamer = useCallback(
    (handle: string): Streamer | undefined => {
      const key = handle.replace(/^@/, "").toLowerCase();
      if (profile && profile.address && profile.handle.toLowerCase() === key) {
        const { handle: h, name, address, socials, tiers, donatePresets, avatarUrl, avatarEnabled } = profile;
        return { handle: h, name, address, socials, tiers, donatePresets, avatarUrl, avatarEnabled };
      }
      return serverPages[key] ?? MOCK_STREAMERS[key];
    },
    [profile, serverPages]
  );

  // Chain mode + wallet connected → refresh the book for every streamer we can
  // show. Source of truth: crown-index (ICP) when its principal is configured;
  // otherwise OUR mirror (/api/reputation — the DB the indexer fills from
  // devnet). Same unit either way: USDC minor units; 1 point = $1 (front.md §4).
  useEffect(() => {
    if (mode !== "chain" || !wallet.address) return;
    let dead = false;
    const targets: Record<string, string> = {};
    for (const [h, s] of Object.entries(MOCK_STREAMERS)) targets[h] = s.address;
    for (const [h, s] of Object.entries(serverPages)) if (s.address) targets[h] = s.address;
    if (profile?.address) targets[profile.handle.toLowerCase()] = profile.address;

    const refresh = async () => {
      const next: Record<string, number> = {};
      if (isIndexConfigured()) {
        for (const [h, addr] of Object.entries(targets)) {
          if (!isValidAddress(addr)) continue;
          const rep = await fetchReputation(wallet.address!, addr);
          if (rep !== null) next[h] = Number(rep / BigInt(10 ** USDC_DECIMALS));
        }
      } else {
        try {
          const r = await fetch(`/api/reputation?payer=${encodeURIComponent(wallet.address!)}`);
          if (r.ok) {
            const { rows } = (await r.json()) as { rows: { streamer: string; total: number }[] };
            const byAddr = new Map(rows.map((x) => [x.streamer, x.total]));
            for (const [h, addr] of Object.entries(targets)) {
              const total = byAddr.get(addr);
              if (total !== undefined) next[h] = Math.floor(total / 10 ** USDC_DECIMALS);
            }
          }
        } catch {}
      }
      if (!dead && Object.keys(next).length) setChainRep(next);
    };

    void refresh();
    // Finalization + the 30–60s ingest cadence — refreshing faster only burns RPC.
    const t = setInterval(() => void refresh(), 45_000);
    return () => {
      dead = true;
      clearInterval(t);
    };
  }, [mode, wallet.address, profile?.address, profile?.handle, serverPages]);

  // Chain mode: the feed is the mirror of finalized Settled events (our DB,
  // filled by the indexer) — not the mock list. Global firehose on the home
  // surfaces; per-streamer pages filter by address via getStreamer upstream.
  useEffect(() => {
    if (mode !== "chain") return;
    let dead = false;
    // Signatures already shown — anything new after the first load is a LIVE
    // donation: push it to the BroadcastChannel so the bell and OBS overlays
    // ring exactly like they do in mock mode.
    const seen = new Set<string>();
    let primed = false;
    const load = async () => {
      try {
        const r = await fetch("/api/feed?limit=60");
        if (!r.ok) return;
        const { donations } = (await r.json()) as {
          donations: { signature: string; blockTime: number | null; payer: string; streamer?: string; gross: number; source: string; donorName: string | null; message: string | null }[];
        };
        if (dead) return;
        const addrToHandle = new Map<string, string>();
        for (const [h, st] of Object.entries(MOCK_STREAMERS)) addrToHandle.set(st.address, h);
        for (const [h, st] of Object.entries(serverPages)) if (st.address) addrToHandle.set(st.address, h);
        if (profile?.address) addrToHandle.set(profile.address, profile.handle.toLowerCase());
        for (const d of donations) {
          if (seen.has(d.signature)) continue;
          seen.add(d.signature);
          if (!primed) continue; // first page load: history, not news
          const h = d.streamer ? addrToHandle.get(d.streamer) : undefined;
          if (!h) continue;
          publishDonation({
            handle: h,
            from: d.donorName ?? `${d.payer.slice(0, 4)}…${d.payer.slice(-4)}`,
            amount: Math.floor(d.gross / 10 ** USDC_DECIMALS),
            message: d.message ?? undefined,
            ts: Date.now(),
          });
        }
        primed = true;
        const rows: Donation[] = donations.map((d) => {
          const when = d.blockTime ? new Date(d.blockTime * 1000) : new Date();
          const mins = Math.max(0, Math.round((Date.now() - when.getTime()) / 60000));
          return {
            id: d.signature,
            from: d.donorName ?? `${d.payer.slice(0, 4)}…${d.payer.slice(-4)}`,
            amount: Math.floor(d.gross / 10 ** USDC_DECIMALS),
            message: d.message ?? undefined,
            source: (["task", "roulette", "fundraiser", "auction"].includes(d.source) ? d.source : "direct") as Donation["source"],
            date: when.toISOString().slice(0, 10),
            time: mins < 1 ? "just now" : mins < 60 ? `${mins} min ago` : mins < 1440 ? `${Math.floor(mins / 60)} h ago` : `${Math.floor(mins / 1440)} d ago`,
            // On-chain extras so the Donations tab can show exact time + the tx on the explorer.
            at: d.blockTime ? d.blockTime * 1000 : undefined,
            sig: d.signature,
            payer: d.payer,
          };
        });
        if (rows.length) setFeed(rows);
      } catch {}
    };
    void load();
    const t = setInterval(() => void load(), 15_000);
    return () => {
      dead = true;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, serverPages, profile?.address]);

  const getCampaign = useCallback(
    (handle: string, slug: string) => campaigns[`${handle.replace(/^@/, "").toLowerCase()}/${slug}`],
    [campaigns]
  );

  const applyMockDonation = useCallback((input: DonateInput) => {
    const key = input.handle.replace(/^@/, "").toLowerCase();
    const from = (input.name || "You").trim() || "You";
    const message = input.message?.trim() || undefined;
    const today = new Date().toISOString().slice(0, 10);
    const id = `d${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; // unique even within one ms
    setFeed((prev) => [
      { id, from, amount: input.amount, message, source: input.source ?? "direct", date: today, time: "just now", fresh: true },
      ...prev,
    ]);
    // Push to OBS overlays (other tabs) in real time — mock source of donation events.
    publishDonation({ handle: key, from, amount: input.amount, message, ts: Date.now() });
    // Telegram, if the streamer connected the bot (Settings → Telegram). Fire-and-forget: a dead
    // endpoint must never break a donation.
    void fetch("/api/telegram/notify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handle: key, kind: "donation", title: `${from} donated $${input.amount}`, body: message ?? "" }),
    }).catch(() => {});
    // Reputation accrues to THIS streamer only.
    setReputation((r) => ({ ...r, [key]: (r[key] ?? 0) + input.amount }));
    setLastGain({ handle: key, amount: input.amount });
    setTimeout(() => setLastGain(null), 2600);
    // Only bump a campaign's total when the donation was actually made on that campaign's page.
    if (input.slug) {
      const campKey = `${key}/${input.slug}`;
      setCampaigns((prev) => {
        const c = prev[campKey];
        if (!c) return prev;
        return { ...prev, [campKey]: { ...c, raised: c.raised + input.amount, count: c.count + 1 } };
      });
    }
  }, []);

  const donate = useCallback<CrownCtx["donate"]>(
    async (input, walletAddress) => {
      if (mode === "mock") {
        await new Promise((r) => setTimeout(r, 1200));
        applyMockDonation(input);
        return {};
      }

      // chain — one Solana devnet transaction through the splitter:
      // [ensure ATAs] + donate(gross). No approve step exists on Solana.
      if (!isSplitterConfigured()) throw new NotConfiguredError();
      const donor = walletAddress ?? wallet.address;
      if (!donor) throw new Error("Connect your wallet first.");
      const streamer = getStreamer(input.handle);
      if (!streamer) throw new Error("Streamer not found.");
      if (!isValidAddress(streamer.address)) throw new Error("This page's payout address isn't a valid Solana address yet.");

      const gross = toMinorUnits(input.amount);
      const tx = buildDonateTx(new PublicKey(donor), new PublicKey(streamer.address), gross);
      // The donor's own wallet signs and pays — that native signature IS the
      // attribution: the Settled event credits this wallet in the book.
      const txHash = await wallet.sendTransaction(tx);
      // Ring the book's doorbell — the reputation row lands in seconds, not on
      // the watchdog's minute. No-op until the canister principal is configured.
      void ingestHint();
      // Attach the donor's words to the signature (the Crown DB). The indexer
      // merges them into the mirrored Settled row — the chain stays wordless.
      void fetch("/api/donations/intent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signature: txHash, handle: input.handle, name: input.name, message: input.message, source: input.source }),
      }).catch(() => {});
      // The book only sees the tx after its finalized-ingest pass (~30–90s).
      // No optimistic local bump: chain mode shows honest numbers.
      return { txHash };
    },
    [mode, applyMockDonation, getStreamer, wallet]
  );

  const getReputation = useCallback(
    (handle: string) => {
      const key = handle.replace(/^@/, "").toLowerCase();
      // Chain overlay wins when present (real book beats mock seed).
      if (mode === "chain" && key in chainRep) return chainRep[key];
      return reputation[key] ?? 0;
    },
    [mode, chainRep, reputation]
  );
  const lastGainFor = useCallback(
    (handle: string) => (lastGain && lastGain.handle === handle.replace(/^@/, "").toLowerCase() ? lastGain.amount : null),
    [lastGain]
  );

  const value = useMemo<CrownCtx>(
    () => ({ mode, setMode, ready, getStreamer, getCampaign, feed, getReputation, lastGainFor, donate, applyMockDonation }),
    [mode, setMode, ready, getStreamer, getCampaign, feed, getReputation, lastGainFor, donate, applyMockDonation]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCrown() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCrown must be used inside DataProvider");
  return ctx;
}
