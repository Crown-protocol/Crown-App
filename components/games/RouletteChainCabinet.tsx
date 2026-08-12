"use client";

import { useCallback, useEffect, useState } from "react";
import { buildAuthMessage } from "@/lib/chain/authMessage";
import { rlFromHex, shortKey } from "@/lib/chain/roulette";
import { connection } from "@/lib/chain/solana";
import { useWallet } from "@/lib/chain/useWallet";
import { buildAnnouncement, roundPayload, STAKE_CUTOFF_SLOTS } from "@/lib/chain/rouletteTx";
import { toMinorUnits } from "@/lib/chain/solana";
import { isValidAddress } from "@/lib/chain/config";
import {
  aliveSlices,
  nextStageSlot,
  phaseOf,
  type ChainRound,
  type ChainWheelView,
} from "@/lib/data/useRouletteChain";
import { usd } from "@/lib/money";
import type { Profile, RouletteConfig } from "@/lib/data/types";
import { PublicKey } from "@solana/web3.js";

/** ~400ms a slot — the number the countdown and the window are both measured in. */
const SLOTS_PER_MINUTE = 150;

/**
 * Slots between knock-outs on an elimination round — half a minute.
 *
 * Long enough that the beacon block of a stage is finalized well before the next
 * one needs reading (~32 slots), and that a viewer whose pick is in danger has
 * time to put money behind it; short enough that a wheel of a dozen titles is
 * decided in minutes rather than in an hour. Committed in the announcement, so
 * the number here is only the default a new round is opened with — a round
 * already taking stakes cannot be re-timed.
 */
const KNOCKOUT_SLOTS = 75;

// ──────────────────────────────────────────────────────────────────
// The maker's side of a chain round: opening one, and watching the one that is
// open.
//
// There are no controls once it is open, and that is the feature. A chain round
// has no "spin now" and no "new round" — its clock is a slot number committed
// before the first stake, and its verdict is a block. The maker cannot hurry it,
// cannot re-roll it and cannot cancel it, which is exactly what makes it worth
// more to a viewer than a wheel the maker could nudge.
// ──────────────────────────────────────────────────────────────────
export function RouletteChainCabinet({
  profile,
  cfg,
  round,
  wheel,
  onOpened,
}: {
  profile: Profile;
  cfg: RouletteConfig;
  round: ChainRound | null;
  wheel: ChainWheelView | null;
  onOpened: () => void;
}) {
  const wallet = useWallet();
  const elimination = cfg.format === "elimination";
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // Titles including the hidden ones — this is the one screen allowed to see
  // them, because it is the screen deciding what to hide.
  const [owned, setOwned] = useState<{ titles: Record<string, string>; hidden: string[] } | null>(null);
  const [moderating, setModerating] = useState("");

  const signedHeaders = useCallback(
    async (body: unknown): Promise<Record<string, string>> => {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (wallet.connected && wallet.address) {
        const ts = Math.floor(Date.now() / 1000);
        const sig = await wallet.signMessage(await buildAuthMessage("roulette-hide", profile.handle, ts, body));
        if (sig) {
          headers["x-cheer-pubkey"] = wallet.address;
          headers["x-cheer-ts"] = String(ts);
          headers["x-cheer-signature"] = Buffer.from(sig).toString("base64");
        }
      }
      return headers;
    },
    [wallet, profile.handle]
  );

  const loadOwned = useCallback(async () => {
    if (!round) return;
    try {
      const r = await fetch(`/api/roulette/entry?round=${round.roundHex}&owner=1`, {
        headers: await signedHeaders(null),
      });
      if (r.ok) setOwned(await r.json());
    } catch {
      /* the board still works without the hidden names */
    }
  }, [round, signedHeaders]);

  // Only once the wallet is there: the owner view needs a signature, and asking
  // for one on mount would pop the wallet at every glance at the cabinet.
  useEffect(() => {
    if (round && wallet.connected && !owned) void loadOwned();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round, wallet.connected]);

  async function toggleHidden(entryHex: string, hidden: boolean) {
    setModerating(entryHex);
    try {
      const body = { roundHex: round?.roundHex, entryHex, hidden };
      const r = await fetch("/api/roulette/entry", {
        method: "PATCH",
        headers: await signedHeaders(body),
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? "Refused.");
      await loadOwned();
      onOpened(); // re-read the wheel so the public view and this one agree
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That didn't go through.");
    } finally {
      setModerating("");
    }
  }

  async function open() {
    setErr("");
    if (!isValidAddress(profile.address)) {
      setErr("Set a valid payout address first — that is the wallet the stakes pay.");
      return;
    }
    if (!wallet.connected) {
      if (!wallet.hasWallet) {
        setErr("No Solana wallet found in the browser. Install Phantom or Solflare.");
        return;
      }
      wallet.connect();
      return;
    }
    setBusy(true);
    try {
      const openSlot = BigInt(await connection().getSlot("finalized"));
      const { bytes, roundId } = await buildAnnouncement({
        recipient: new PublicKey(profile.address),
        openSlot,
        closeSlot: openSlot + BigInt(Math.max(1, cfg.roundMinutes) * SLOTS_PER_MINUTE),
        playMinutes: cfg.playMinutes,
        topic: (cfg.topic || "game").slice(0, 64),
        minDonation: cfg.minDonation ? toMinorUnits(cfg.minDonation) : undefined,
        // The format is the maker's, and it is committed with everything else.
        stageSlots: elimination ? BigInt(KNOCKOUT_SLOTS) : 0n,
        // The nonce only has to tell apart two rounds of the same wallet opened
        // with the same rules; seconds are plenty and read back legibly.
        nonce: BigInt(Math.floor(Date.now() / 1000)),
      });
      const signature = await wallet.signMessage(bytes);
      if (!signature) throw new Error("Signing was declined — a round nobody signed is not a round.");

      const r = await fetch("/api/roulette/round", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          roundPayload({
            handle: profile.handle,
            roundId,
            bytes,
            pubkey: wallet.address ?? "",
            signature,
          })
        ),
      });
      const body = await r.json().catch(() => null);
      if (!r.ok) throw new Error(body?.error ?? "The round was refused.");
      onOpened();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That didn't go through.");
    } finally {
      setBusy(false);
    }
  }

  // A finished round is history, not a state the cabinet is stuck in. Gating the
  // "open" control on `round` alone meant a page could run exactly one chain
  // wheel, ever: `round` is the newest one and never becomes null again.
  const settled = round ? phaseOf(round, wheel) === "decided" : false;

  if (round && !settled) {
    const phase = phaseOf(round, wheel);
    const total = BigInt(wheel?.total ?? "0");
    const winner = wheel?.slices.find((s) => s.key === wheel.winner);
    return (
      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
          <b>Round on chain</b>
          {/* Never a fabricated zero. The wheel takes a moment to come back from
              the chain, and "$0 in the pot" on a round that has money in it is a
              number we made up — the same mistake as a decided round still
              calling itself open. */}
          <span className="num">{wheel ? `${usd(Number(total) / 1e6)} in the pot` : "…"}</span>
        </div>
        <div className="footnote">
          {phase === "open" &&
            (wheel && wheel.stageSlots > 0 && wheel.currentSlot >= round.closeSlot
              ? `Knocking out — ${aliveSlices(wheel).length} still in, next at slot ${nextStageSlot(round, wheel).toLocaleString()}.`
              : `Open — closes at slot ${round.closeSlot.toLocaleString()}.`)}
          {phase === "closing" && "Closing — new stakes can no longer reach a block in time."}
          {phase === "settling" && "Closed — waiting for the block that decides it."}
          {phase === "decided" && `The wheel has spoken: ${winner?.title ?? "an unnamed slice"}.`}
          {/* Until the chain answers there is no phase to state, and an empty
              line under the heading reads as something failing to load. */}
          {phase === "unknown" && "Reading the round from the chain…"}
        </div>
        <div className="footnote">
          Nothing to press. This round&apos;s clock is a slot committed before the first stake and its winner is a
          Solana block — you cannot spin it early, re-roll it or cancel it, and that is what a viewer is trusting when
          they stake. Open a new round when this one is done.
        </div>
        {wheel?.stages.length ? (
          <div className="footnote" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {wheel.stages.map((st) => {
              const gone = wheel.slices.find((x) => x.key === st.out);
              return (
                <span key={st.stage}>
                  #{st.stage + 1} out:{" "}
                  {owned?.titles[st.out] ??
                    gone?.title ??
                    shortKey(rlFromHex(st.out) ?? new Uint8Array(32))}{" "}
                  · block {st.beacon.slot.toLocaleString()}
                </span>
              );
            })}
          </div>
        ) : null}
        {wheel?.beacon && (
          <div className="footnote" style={{ fontFamily: "monospace", wordBreak: "break-all" }}>
            block {wheel.beacon.slot.toLocaleString()} · {wheel.beacon.hash}
          </div>
        )}

        {/* Moderation, and the only kind this game can have: the name comes off
            the page, the slice stays on the wheel. There is no button here that
            could remove a stake, because a stake is money that already moved and
            a slice the chain already carries. */}
        {wheel?.slices.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
            <b style={{ fontSize: 14 }}>Names on the wheel</b>
            {wheel.slices.map((s) => {
              const isHidden = s.hidden;
              const title = owned?.titles[s.key] ?? s.title;
              return (
                <div key={s.key} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                  <span style={{ opacity: isHidden ? 0.55 : 1 }}>
                    {title ?? (
                      <span style={{ fontFamily: "monospace" }}>{shortKey(rlFromHex(s.key) ?? new Uint8Array(32))}</span>
                    )}
                    <span className="footnote"> · {usd(Number(BigInt(s.weight)) / 1e6)}</span>
                    {isHidden && <span className="footnote"> · hidden</span>}
                  </span>
                  <button
                    type="button"
                    className="chip"
                    disabled={moderating === s.key || (!title && !isHidden)}
                    onClick={() => void toggleHidden(s.key, !isHidden)}
                  >
                    {moderating === s.key ? "…" : isHidden ? "Show" : "Hide"}
                  </button>
                </div>
              );
            })}
            <div className="footnote">
              Hiding takes the word off the public page — it does not take the slice off the wheel, and it cannot: the
              winner is drawn from keys, so a hidden name can still win. It is also not secrecy. Whoever staked it still
              has the word, and anyone who guesses it can check the guess against the chain.
            </div>
          </div>
        ) : null}
        {err && <div className="footnote" style={{ color: "var(--error)" }}>{err}</div>}
      </div>
    );
  }

  const lastWinner = wheel?.slices.find((s) => s.key === wheel.winner);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {round && settled && (
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
            <b>Last round on chain</b>
            <span className="num">{usd(Number(BigInt(wheel?.total ?? "0")) / 1e6)} in the pot</span>
          </div>
          <div className="footnote">
            The wheel gave it to{" "}
            <b>
              {lastWinner?.title ??
                (lastWinner ? shortKey(rlFromHex(lastWinner.key) ?? new Uint8Array(32)) : "an unnamed slice")}
            </b>
            . It stays here as a record — a decided round cannot be reopened, spun again or taken back.
          </div>
          {/* Moderation outlives the round: a name that should come down is
              usually noticed after the wheel has spoken, not before. */}
          {wheel?.slices.length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {wheel.slices.map((s) => {
                const title = owned?.titles[s.key] ?? s.title;
                return (
                  <div key={s.key} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                    <span style={{ opacity: s.hidden ? 0.55 : 1 }}>
                      {title ?? <span style={{ fontFamily: "monospace" }}>{shortKey(rlFromHex(s.key) ?? new Uint8Array(32))}</span>}
                      {/* The weight, because "should this name come down" is a
                          different decision on a slice holding most of the pot. */}
                      <span className="footnote"> · {usd(Number(BigInt(s.weight)) / 1e6)}</span>
                      {s.hidden && <span className="footnote"> · hidden</span>}
                    </span>
                    <button
                      type="button"
                      className="chip"
                      disabled={moderating === s.key || (!title && !s.hidden)}
                      onClick={() => void toggleHidden(s.key, !s.hidden)}
                    >
                      {moderating === s.key ? "…" : s.hidden ? "Show" : "Hide"}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : null}
          <a className="footnote" style={{ color: "var(--accent)" }} href={`/@${profile.handle}/roulette/verify/${round.roundHex}`}>
            Anyone can check this round →
          </a>
        </div>
      )}

    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <b>{round && settled ? "Open the next round" : "Open a round on chain"}</b>
      <div className="footnote">
        Stakes become real donations with a memo that ties them to this round, and the winner is decided by a Solana
        block instead of by us. You sign the rules once — {cfg.roundMinutes} min of stakes, {cfg.playMinutes} min of
        play{elimination ? ", one knocked out every 30s until one is left" : ""} — and they cannot change afterwards,
        not even by you.
      </div>
      <button type="button" className="btn" disabled={busy} onClick={open}>
        {busy ? "Opening…" : "Sign and open"}
      </button>
      {err ? (
        <div className="footnote" style={{ color: "var(--error)" }}>{err}</div>
      ) : (
        <div className="footnote">
          Signing costs nothing and moves nothing — it is a signature over the rules, not a transaction. Stakes stop
          being accepted about a minute ({STAKE_CUTOFF_SLOTS} slots) before the close, so a viewer&apos;s payment can
          still reach a block in time.
        </div>
      )}
    </div>
    </div>
  );
}
