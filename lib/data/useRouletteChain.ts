"use client";

import { useCallback, useEffect, useState } from "react";
import { STAKE_CUTOFF_SLOTS } from "@/lib/chain/rouletteTx";

// ──────────────────────────────────────────────────────────────────
// The chain-mode round, as a page needs it.
//
// Two reads and no state of our own: which round a page is running, and what the
// chain says its wheel looks like. The showcase never computes a winner — it
// asks for one, and anyone can ask the same question of the chain directly.
// ──────────────────────────────────────────────────────────────────

export interface ChainRound {
  roundHex: string;
  handle: string;
  chain: string;
  recipient: string;
  announcement: string;
  pubkey: string;
  signature: string;
  openSlot: number;
  closeSlot: number;
  createdAt: number;
}

export interface ChainWheelView {
  roundHex: string;
  slices: {
    key: string;
    weight: string;
    /** `null` when the title is unknown here — never published, or hidden. */
    title: string | null;
    /** Hidden by the maker, as opposed to never named. Different facts, shown differently. */
    hidden: boolean;
    /** Knocked out at some stage of an elimination round. */
    out: boolean;
    /** Staked into an elimination round after its field was fixed: not in the running. */
    late: boolean;
  }[];
  total: string;
  counted: number;
  excluded: number;
  truncated: boolean;
  beacon: { slot: number; hash: string } | null;
  winner: string | null;
  currentSlot: number;
  /** Knock-outs so far — empty unless the round is on elimination. */
  stages: { stage: number; slot: number; beacon: { slot: number; hash: string }; out: string }[];
  /** Slots between knock-outs; `0` means one spin decides it. */
  stageSlots: number;
}

/** How the round reads to someone looking at it right now. */
export type RoundPhase =
  /** Still taking stakes. */
  | "open"
  /** Inside the cutoff: too late to land in a block, so the form is closed even though the round is not. */
  | "closing"
  /** Past the close slot, waiting for the beacon block to finalize. */
  | "settling"
  /** The beacon exists and the wheel has spoken. */
  | "decided"
  /**
   * We do not know what time it is on chain — the wheel has not been read yet,
   * or the read is failing. **Never treated as open.**
   */
  | "unknown";

/**
 * How far behind the tip a `finalized` slot is, in slots (~32 by construction),
 * plus one poll interval of staleness. Subtracted from the stake window because
 * `currentSlot` is a finalized slot: it says the past, and the wrong direction to
 * be wrong in here is "the donor thinks there is more time than there is".
 */
export const FINALIZED_LAG_SLOTS = 32 + 15;

/** Where the next knock-out of an elimination round falls, in slots. */
export function nextStageSlot(round: ChainRound, wheel: ChainWheelView | null): number {
  if (!wheel || wheel.stageSlots <= 0) return round.closeSlot;
  return round.closeSlot + wheel.stages.length * wheel.stageSlots;
}

/** Slices still in the running: not knocked out, and not staked in too late. */
export function aliveSlices(wheel: ChainWheelView | null): ChainWheelView["slices"] {
  return (wheel?.slices ?? []).filter((s) => !s.out && !s.late);
}

export function phaseOf(round: ChainRound, wheel: ChainWheelView | null): RoundPhase {
  if (wheel?.winner) return "decided";
  // An elimination round is still being played after its close: stakes keep
  // counting toward the next knock-out, so it is open, not settling.
  //
  // Only the LAST knock-out is a deadline. Money that misses an earlier stage
  // still counts in every stage after it, so closing the form at each boundary
  // would refuse stakes that would have been perfectly good.
  if (wheel && wheel.stageSlots > 0) {
    if (!wheel.currentSlot) return "unknown";
    const next = nextStageSlot(round, wheel);
    const now = wheel.currentSlot + FINALIZED_LAG_SLOTS;
    if (aliveSlices(wheel).length <= 2) {
      if (now >= next) return "settling";
      if (now >= next - STAKE_CUTOFF_SLOTS) return "closing";
    }
    return "open";
  }
  const slot = wheel?.currentSlot ?? 0;
  // Not knowing the time is not the same as having time. Defaulting to "open"
  // here put a live stake form in front of a donor while the round could already
  // be closed — money that lands and never reaches the wheel, which is the one
  // loss this game says it will not let happen quietly.
  if (!slot) return "unknown";
  const now = slot + FINALIZED_LAG_SLOTS;
  if (now >= round.closeSlot) return "settling";
  // The margin is for getting INTO a block, not for finality: between the
  // signature and inclusion sit a wallet prompt, the send and a leader's turn.
  if (now >= round.closeSlot - STAKE_CUTOFF_SLOTS) return "closing";
  return "open";
}

/**
 * The page's live round: the newest one this handle has opened, and its wheel.
 *
 * Polled rather than pushed, at a deliberately unhurried 6s: every wheel read
 * walks the chain, so this is the one screen in the app whose refresh costs real
 * upstream requests.
 */
export function useRouletteChain(handle: string | null): {
  round: ChainRound | null;
  wheel: ChainWheelView | null;
  loading: boolean;
  refresh: () => void;
} {
  const [round, setRound] = useState<ChainRound | null>(null);
  const [wheel, setWheel] = useState<ChainWheelView | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!handle) {
      setLoading(false);
      return;
    }
    let dead = false;
    void (async () => {
      try {
        const r = await fetch(`/api/roulette/round?handle=${encodeURIComponent(handle)}`).then((x) => x.json());
        if (dead) return;
        setRound(r?.rounds?.[0] ?? null);
      } catch {
        if (!dead) setRound(null);
      } finally {
        if (!dead) setLoading(false);
      }
    })();
    return () => {
      dead = true;
    };
  }, [handle, tick]);

  useEffect(() => {
    if (!round) return;
    let dead = false;
    const load = async () => {
      try {
        const r = await fetch(`/api/roulette/wheel?round=${round.roundHex}`).then((x) => x.json());
        // A failed read leaves the previous wheel on screen rather than blanking
        // it: an empty wheel reads as "nobody staked", which is a lie an RPC
        // hiccup should not be able to tell.
        if (!dead && r?.wheel) setWheel(r.wheel);
      } catch {
        /* keep what we had */
      }
    };
    void load();
    const t = setInterval(() => void load(), 6_000);
    return () => {
      dead = true;
      clearInterval(t);
    };
  }, [round, tick]);

  return { round, wheel, loading, refresh };
}
