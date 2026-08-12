"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BarList, StatTile } from "@/components/ops";
import { usd } from "@/lib/money";
import { RouletteWheel } from "@/components/RouletteWheel";
import { rouletteRules } from "@/lib/data/gameConfig";
import { readRound, ensureRound, setRoundWinner, newRound, readRoundMeta, appendHistory, survivors, eliminationWeights, eliminate, type RoundMeta } from "@/lib/data/roulette";
import { useGameSync } from "@/lib/data/gameSync";
import { useRouletteChain } from "@/lib/data/useRouletteChain";
import { RouletteChainCabinet } from "@/components/games/RouletteChainCabinet";
import { pickWeighted, roundRand, type RouletteSuggestion } from "@/lib/data/roulette-mock";
import type { Profile } from "@/lib/data/types";

function fmtLeft(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

// The streamer's view of the open round: the same wheel viewers see, plus the two controls
// the spec gives the content maker — spin early (the maker's call) or open a fresh round. The
// round itself (suggestions, clock, verdict) lives in the shared mock storage, so this and
// the public page stay in step.
export function RouletteOverview({
  profile,
  scope,
  shareQuery = "",
  hasSession = true,
}: {
  profile: Profile;
  scope?: string;
  shareQuery?: string;
  /** Whether an off-chain session exists. A chain round needs none. */
  hasSession?: boolean;
}) {
  const handle = scope ?? profile.handle;
  // Shared game state: pulls the server copy into localStorage; the 1s tick below re-reads it.
  useGameSync(handle);
  // This round's rules — the ones the session was opened with, not whatever the profile says today.
  const cfg = rouletteRules(profile, handle);
  // A round on chain replaces this whole panel rather than sitting beside it:
  // two wheels on one page would be two clocks over the same money.
  const chain = useRouletteChain(profile.handle);

  const [round, setRound] = useState<RouletteSuggestion[]>([]);
  const [meta, setMeta] = useState<RoundMeta | null>(null);
  const [now, setNow] = useState(0);
  const [spin, setSpin] = useState<{ id: string; nonce: number }>({ id: "", nonce: 0 });
  // Which spin we've already fired. Single rounds key on the round clock; elimination rounds add
  // the knock-out count, because one round legitimately spins many times.
  const spunFor = useRef<string | null>(null);
  const recordedFor = useRef<number | null>(null);

  useEffect(() => {
    setRound(readRound(handle));
    setMeta(ensureRound(handle));
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [handle]);

  // Keep up with suggestions and verdicts landing from the public page.
  useEffect(() => {
    if (!now || !meta) return;
    setRound(readRound(handle));
    const m = readRoundMeta(handle);
    if (!m) return;
    if (m.startedAt !== meta.startedAt) {
      // A fresh round started (here or elsewhere): drop the finished round's spin, otherwise
      // `spinning` (spin.nonce > 0 && no winner) stays stuck true and disables "Spin now".
      setMeta(m);
      setSpin({ id: "", nonce: 0 });
      spunFor.current = null;
      return;
    }
    if (m.winner && !meta.winner && spunFor.current !== String(m.startedAt)) {
      spunFor.current = String(m.startedAt);
      setSpin((s) => ({ id: m.winner!.id, nonce: s.nonce + 1 }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now]);

  const total = round.reduce((sum, s) => sum + s.pool, 0);
  const deadline = meta ? meta.startedAt + cfg.roundMinutes * 60_000 : 0;
  const msLeft = meta && now ? deadline - now : 1;
  const expired = msLeft <= 0;
  const spinning = spin.nonce > 0 && !meta?.winner;
  const rankMode = meta?.mode === "rank";
  // Nothing pitched yet and no verdict — an empty wheel says nothing, so we show a share prompt instead.
  const empty = !meta?.winner && round.length === 0;

  // Time's up — the wheel spins itself, same as on the public page.
  useEffect(() => {
    if (!now || !meta || meta.winner || !expired) return;
    if (spunFor.current === String(meta.startedAt)) return;
    if (!round.length) {
      setMeta(newRound(handle));
      return;
    }
    spinNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, meta, expired]);

  // Elimination rounds spin many times, so the once-per-round guard is keyed on how many are already
  // out — otherwise the second knock-out would be refused as "already spun".
  const elimination = (cfg.format ?? "single") === "elimination";
  const alive = elimination ? survivors(round, meta) : round;

  function spinNow() {
    if (!meta || meta.winner) return;
    const list = readRound(handle);
    if (!list.length) return;

    if (elimination) {
      const left = survivors(list, meta);
      if (left.length < 2) return; // nothing to knock out
      const key = `${meta.startedAt}:${(meta.eliminated ?? []).length}`;
      if (spunFor.current === key) return;
      // Money PROTECTS: weights are inverted pools, so the best-backed entry is the least likely to go.
      const victim = pickWeighted(left, roundRand(meta.startedAt + (meta.eliminated ?? []).length), eliminationWeights(left));
      if (!victim) return;
      spunFor.current = key;
      setSpin((s) => ({ id: victim.id, nonce: s.nonce + 1 }));
      return;
    }

    if (spunFor.current === String(meta.startedAt)) return;
    // Seeded by the round clock — the cabinet and every viewer land the same winner.
    const w = pickWeighted(list, roundRand(meta.startedAt));
    if (!w) return;
    spunFor.current = String(meta.startedAt);
    setSpin((s) => ({ id: w.id, nonce: s.nonce + 1 }));
  }

  function landed(id: string) {
    const list = readRound(handle);
    const w = list.find((s) => s.id === id);
    if (!w) return;

    if (elimination) {
      // The wheel landed on the one that's OUT. eliminate() promotes the last survivor to winner, so
      // the history block below runs on the final spin exactly as it does for a single-spin round.
      const next = eliminate(handle, w.id, list);
      setMeta(next);
      if (!next.winner) return; // more spins to come
      const champ = list.find((s) => s.id === next.winner!.id);
      if (champ && meta && recordedFor.current !== meta.startedAt) {
        recordedFor.current = meta.startedAt;
        appendHistory(profile.handle, {
          id: `r-${meta.startedAt}`,
          date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
          winner: champ.title,
          genre: champ.genre,
          pot: list.reduce((sum, s) => sum + s.pool, 0),
          entries: list.length,
          playedMinutes: cfg.playMinutes,
        });
      }
      return;
    }

    setMeta(setRoundWinner(handle, { id: w.id, title: w.title }));
    // Record the finished round exactly once, so the History tab shows real rounds — not just the seed.
    if (meta && recordedFor.current !== meta.startedAt) {
      recordedFor.current = meta.startedAt;
      appendHistory(profile.handle, {
        id: `r-${meta.startedAt}`,
        date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
        winner: w.title,
        genre: w.genre,
        pot: list.reduce((sum, s) => sum + s.pool, 0),
        entries: list.length,
        playedMinutes: cfg.playMinutes,
      });
    }
  }

  function startNewRound() {
    setMeta(newRound(handle));
    setRound(readRound(handle));
    // Clear the previous round's spin so the fresh round isn't stuck in "Spinning…".
    setSpin({ id: "", nonce: 0 });
    spunFor.current = null;
    recordedFor.current = null;
  }

  if (chain.round) {
    return (
      <RouletteChainCabinet
        profile={profile}
        cfg={cfg}
        round={chain.round}
        wheel={chain.wheel}
        onOpened={chain.refresh}
      />
    );
  }

  // No chain round and no session: this is the maker's first look at the game,
  // and the only thing worth offering is the one that needs nothing first.
  if (!hasSession) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <RouletteChainCabinet profile={profile} cfg={cfg} round={null} wheel={null} onOpened={chain.refresh} />
        <div className="footnote" style={{ textAlign: "center" }}>
          Prefer the off-chain wheel — free entries, knock-out rounds, a clock this app keeps? Start a session under
          Sessions instead.
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <RouletteChainCabinet profile={profile} cfg={cfg} round={null} wheel={null} onOpened={chain.refresh} />
      <div className="footnote">
        Viewers suggest a game by donating toward it — slice size is the pool&apos;s share, and the share is the odds.
        {" "}
        {/* The two modes below are NOT settled by the chain, and saying so is the
            same obligation the spec puts on the wheel itself: rank has no
            transaction to count, and elimination needs a beacon per knock-out
            (`crown-games/roulette/docs/spec.md §Вердикт`). */}
        <b>This wheel is off-chain</b> — its clock and its spin are this app&apos;s, not the chain&apos;s.
      </div>

      {empty ? (
        <div className="empty-log">
          No suggestions yet — viewers pitch a game on your{" "}
          <Link href={`/@${profile.handle}/roulette${shareQuery}`} target="_blank" style={{ color: "var(--accent)" }}>
            roulette page
          </Link>
          . Each one is a donation toward what they want you to play.
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 28, alignItems: "center", flexWrap: "wrap" }}>
            <RouletteWheel
              round={rankMode ? round.map((x) => ({ ...x, pool: x.pool || 1 })) : round}
              spinToId={spin.id || null}
              spinNonce={spin.nonce}
              onLanded={landed}
              winnerId={meta?.winner?.id ?? null}
              size={260}
            />

            <div style={{ display: "flex", flexDirection: "column", gap: 14, flex: 1, minWidth: 220 }}>
              <div style={{ fontSize: 15, color: "var(--text-2)" }}>
                {meta?.winner ? (
                  <>
                    <span className="pill ok" style={{ marginRight: 8 }}>
                      <span className="dot" />
                      {meta.winner.title}
                    </span>
                    The wheel has spoken — you play it for {cfg.playMinutes} min.
                  </>
                ) : spinning ? (
                  "Spinning…"
                ) : expired ? (
                  "Time's up — spinning."
                ) : (
                  "Round is open — viewers are pitching games below."
                )}
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {!meta?.winner ? (
                  <button className="btn" type="button" disabled={!round.length || spinning} onClick={spinNow}>
                    {spinning ? "Spinning…" : "Spin now"}
                  </button>
                ) : (
                  <button className="btn" type="button" onClick={startNewRound}>
                    New round
                  </button>
                )}
              </div>

              <div className="footnote">
                {meta?.winner
                  ? "A new round clears the wheel and restarts the clock."
                  : "The wheel also spins on its own when the clock runs out. Losing pools stay donated."}
              </div>
            </div>
          </div>

          <div className="stat-grid">
            <StatTile k="Pot" v={usd(total)} />
            <StatTile k="Closes in" v={meta?.winner ? "Closed" : fmtLeft(msLeft)} />
            <StatTile k="Suggestions" v={String(round.length)} />
          </div>

          {round.length > 0 && (
            <BarList unit="money" bars={round.map((r) => ({ label: `${r.title} · ${r.genre}`, value: r.pool, display: usd(r.pool) }))} />
          )}
        </>
      )}
    </div>
  );
}
