"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { isSplitterConfigured, isIndexConfigured, isValidAddress, USDC_DECIMALS } from "@/lib/chain/config";
import { buildDirectDonateTx } from "@/lib/chain/direct";
import { toMinorUnits } from "@/lib/chain/solana";
import { fetchReputation } from "@/lib/chain/icp";
import { useSolanaWallet } from "@/lib/chain/wallet";
import type { Donation, DonateInput, Streamer, Campaign } from "./types";
import { publishDonation } from "./donationStream";
import { useProfile } from "./ProfileProvider";

export class NotConfiguredError extends Error {
  constructor() {
    super("The splitter program isn't configured for this network yet. Ask the backend dev and set it in lib/chain/config.ts.");
    this.name = "NotConfiguredError";
  }
}

// There is one source of data and it is the chain plus our mirror of it. The
// mock mode and the sample-data toggle that used to live here are gone: a screen
// that can show invented numbers eventually shows them to someone who believes
// them, and every surface below now reads a real balance, a real book, or zero.
interface CheerCtx {
  ready: boolean;
  getStreamer: (handle: string) => Streamer | undefined;
  getCampaign: (handle: string, slug: string) => Campaign | undefined;
  feed: Donation[];
  // Reputation is per-streamer, keyed by handle — never a single global number (front.md §4).
  getReputation: (handle: string) => number;
  lastGainFor: (handle: string) => number | null;
  // Send a donation — one real Solana transaction in the `direct-settlement`
  // shape. `fee`/`net` are the split it actually made (USDC minor units); the
  // screen has to show them, because reputation is earned on `net` and reporting
  // the gross reads as short-changing the donor.
  donate: (input: DonateInput, walletAddress?: string) => Promise<{ txHash?: string; fee?: number; net?: number }>;
}

const Ctx = createContext<CheerCtx | null>(null);

export function DataProvider({ children }: { children: React.ReactNode }) {
  const { profile } = useProfile();
  const wallet = useSolanaWallet();
  const [ready, setReady] = useState(false);

  // Everything starts empty and fills from the chain (or our mirror of it).
  // Empty is an honest state: a creator with no donations yet has none.
  const [feed, setFeed] = useState<Donation[]>([]);
  // Per-streamer reputation: { handle → points }. A viewer earns reputation with
  // each creator separately; there is no global number.
  const [chainRep, setChainRep] = useState<Record<string, number>>({});
  const [campaigns] = useState<Record<string, Campaign>>({});
  const [lastGain, setLastGain] = useState<{ handle: string; amount: number } | null>(null);

  useEffect(() => {
    setReady(true);
  }, []);

  // Pages registered on the server (the Cheer DB) — so a public /@handle
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
      return serverPages[key];
    },
    [profile, serverPages]
  );

  // Wallet connected → refresh the book for every creator we can show. Source of
  // truth: crown-indexer when its principal is configured; otherwise OUR mirror
  // (/api/reputation — the DB our indexer fills from the chain). Same unit
  // either way: USDC minor units; 1 point = $1 (front.md §4).
  useEffect(() => {
    if (!wallet.address) return;
    let dead = false;
    const targets: Record<string, string> = {};
    for (const [h, s] of Object.entries(serverPages)) if (s.address) targets[h] = s.address;
    if (profile?.address) targets[profile.handle.toLowerCase()] = profile.address;

    const refresh = async () => {
      const next: Record<string, number> = {};
      if (isIndexConfigured()) {
        for (const [h, addr] of Object.entries(targets)) {
          if (!isValidAddress(addr)) continue;
          const rep = await fetchReputation(wallet.address!, addr);
          // Divide in floating point, not in bigint: `rep / BigInt(1e6)` truncates,
          // so every reputation under a dollar read as zero — including the one the
          // book had just recorded.
          if (rep !== null) next[h] = Number(rep) / 10 ** USDC_DECIMALS;
        }
      } else {
        try {
          const r = await fetch(`/api/reputation?payer=${encodeURIComponent(wallet.address!)}`);
          if (r.ok) {
            const { rows } = (await r.json()) as { rows: { streamer: string; total: number }[] };
            const byAddr = new Map(rows.map((x) => [x.streamer, x.total]));
            for (const [h, addr] of Object.entries(targets)) {
              const total = byAddr.get(addr);
              if (total !== undefined) next[h] = total / 10 ** USDC_DECIMALS;
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
  }, [wallet.address, profile?.address, profile?.handle, serverPages]);

  // The feed is the mirror of finalized `Settled` events (our DB, filled by the
  // indexer). Global firehose on the home surfaces; per-creator pages filter by
  // address via getStreamer upstream.
  useEffect(() => {
    let dead = false;
    // Signatures already shown — anything new after the first load is a LIVE
    // donation: push it to the BroadcastChannel so the bell and the OBS overlays
    // ring.
    const seen = new Set<string>();
    let primed = false;
    const load = async () => {
      try {
        // ?handle= so the server can attach this page's in-flight donations; intents are keyed by
        // handle, not by payout address.
        const mine = profile?.handle ? `&handle=${encodeURIComponent(profile.handle)}` : "";
        const r = await fetch(`/api/feed?limit=60${mine}`);
        if (!r.ok) return;
        const { donations, pending = [] } = (await r.json()) as {
          donations: { signature: string; blockTime: number | null; payer: string; streamer?: string; gross: number; source: string; donorName: string | null; message: string | null }[];
          pending?: { signature: string; donorName: string | null; message: string | null; source: string; createdAt: number }[];
        };
        if (dead) return;
        const addrToHandle = new Map<string, string>();
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
            amount: d.gross / 10 ** USDC_DECIMALS,
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
            amount: d.gross / 10 ** USDC_DECIMALS,
            message: d.message ?? undefined,
            source: (["task", "roulette", "fundraiser"].includes(d.source) ? d.source : "direct") as Donation["source"],
            date: when.toISOString().slice(0, 10),
            time: mins < 1 ? "just now" : mins < 60 ? `${mins} min ago` : mins < 1440 ? `${Math.floor(mins / 60)} h ago` : `${Math.floor(mins / 1440)} d ago`,
            // On-chain extras so the Donations tab can show exact time + the tx on the explorer.
            at: d.blockTime ? d.blockTime * 1000 : undefined,
            sig: d.signature,
            payer: d.payer,
            streamer: d.streamer,
            status: "settled",
          };
        });

        // In-flight rows go on top: they are the newest thing that happened, and they are what the
        // creator is actually waiting on. Amount is unknown until the chain confirms it — the intent
        // records who and what, not how much — so the panel shows a dash rather than inventing one.
        const inFlight: Donation[] = pending.map((p) => ({
          id: p.signature,
          from: p.donorName ?? "Someone",
          amount: 0,
          message: p.message ?? undefined,
          source: (["task", "roulette", "fundraiser"].includes(p.source) ? p.source : "direct") as Donation["source"],
          date: new Date(p.createdAt).toISOString().slice(0, 10),
          time: "just now",
          at: p.createdAt,
          sig: p.signature,
          streamer: profile?.address,
          status: "sending",
        }));

        const merged = [...inFlight, ...rows];
        if (merged.length) setFeed(merged);
      } catch {}
    };
    void load();
    const t = setInterval(() => void load(), 15_000);
    return () => {
      dead = true;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverPages, profile?.address]);

  const getCampaign = useCallback(
    (handle: string, slug: string) => campaigns[`${handle.replace(/^@/, "").toLowerCase()}/${slug}`],
    [campaigns]
  );

  const donate = useCallback<CheerCtx["donate"]>(
    async (input, walletAddress) => {
      // One Solana transaction in the `direct-settlement` shape: our 2%
      // straight to the fee wallet, the rest to the creator through the splitter.
      // No approve step exists on Solana; the donor's own signature authorizes both
      // transfers, and that signature IS the attribution — the `Settled` event
      // credits this wallet in the book.
      if (!isSplitterConfigured()) throw new NotConfiguredError();
      const donor = walletAddress ?? wallet.address;
      if (!donor) throw new Error("Connect your wallet first.");
      const streamer = getStreamer(input.handle);
      if (!streamer) throw new Error("Streamer not found.");
      if (!isValidAddress(streamer.address)) throw new Error("This page's payout address isn't a valid Solana address yet.");

      const gross = toMinorUnits(input.amount);
      // Words decide the shape. A donor who wrote a name or a message is buying
      // our side of the donation — the caption, the alert, the book entry — and
      // pays the 2% for it. A donor who wrote nothing gets the bare transfer:
      // full amount, no cut, and nothing of ours attached to it.
      const wantsWords = !!(input.name?.trim() || input.message?.trim());
      const { tx, split } = buildDirectDonateTx(new PublicKey(donor), new PublicKey(streamer.address), gross, {
        withFee: wantsWords,
      });
      const txHash = await wallet.sendTransaction(tx);
      // Reputation is earned on `net`, never on `gross` — the book sees only what
      // went through the splitter, and the fee deliberately went around it (routing
      // our cut through the splitter would mint reputation for paying ourselves).
      // Callers get the split so the screen can say the same thing.
      //
      // The book's own row is bought, not rung for: folding a transaction is a paid
      // ingest, and only a donation that paid us a fee is ours to buy
      // (`direct-settlement/logic::payable`). A fee-free one is the donor's to fold
      // from their own budget — the submitter refuses it, so we don't even ask.
      // The mirror indexer shows the donation in the feed within the minute either way.
      if (wantsWords) {
        void fetch("/api/ingest", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ signature: txHash }),
        }).catch(() => {});
      }
      // Attach the donor's words to the signature (the Cheer DB). The indexer merges them into the
      // mirrored Settled row — the chain stays wordless.
      //
      // Signed, because a tx signature is public the instant it lands: without proof of the paying
      // wallet, anyone watching could post first and permanently attach their own name and message
      // to this donation (the intent row is first-writer-wins).
      //
      // This costs a SECOND wallet prompt, right after the transaction — wallets ask on every
      // signMessage, there is no silent path. Only donors who actually typed a name or a message
      // are asked: with nothing to attach there is nothing to protect, so the prompt would be pure
      // friction. The text below is written for the person staring at that popup.
      //
      // Fire-and-forget: declining costs the donor their caption, never their donation, which is
      // already on chain by this point.
      if (wantsWords) void (async () => {
        try {
          const ts = Math.floor(Date.now() / 1000);
          const human =
            "Cheer — sign your donation\n\n" +
            "This proves the name and message are yours, so nobody else can put words on your donation.\n" +
            "It is not a transaction: no funds move and no fees are paid.\n\n";
          const msg = new TextEncoder().encode(human + `cheer-app:intent:${txHash.toLowerCase()}:${ts}:-`);
          const sig = await wallet.signMessage(msg);
          if (!sig) return;
          await fetch("/api/donations/intent", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              signature: txHash,
              handle: input.handle,
              name: input.name,
              message: input.message,
              source: input.source,
              payer: donor,
              ts,
              proof: btoa(String.fromCharCode(...sig)),
              preamble: human,
            }),
          });
        } catch {
          // Offline, or the wallet can't sign messages — the donation stands, just uncaptioned.
        }
      })();
      // The book only sees the tx once its ingest is folded (finality first).
      // No optimistic local bump: the numbers on screen are the ones that exist.
      return { txHash, fee: Number(split.fee), net: Number(split.net) };
    },
    [getStreamer, wallet]
  );

  const getReputation = useCallback(
    (handle: string) => {
      // The book is the only truth: a creator this viewer has never paid reads 0.
      return chainRep[handle.replace(/^@/, "").toLowerCase()] ?? 0;
    },
    [chainRep]
  );
  const lastGainFor = useCallback(
    (handle: string) => (lastGain && lastGain.handle === handle.replace(/^@/, "").toLowerCase() ? lastGain.amount : null),
    [lastGain]
  );

  const value = useMemo<CheerCtx>(
    () => ({ ready, getStreamer, getCampaign, feed, getReputation, lastGainFor, donate }),
    [ready, getStreamer, getCampaign, feed, getReputation, lastGainFor, donate]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCheer() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCheer must be used inside DataProvider");
  return ctx;
}
