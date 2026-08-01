"use client";

import { useEffect, useState } from "react";
import { CrownMark, GameIcon } from "@/components/icons";
import { FundraiserFill } from "@/components/FundraiserFill";
import { OVERLAY_TIERS } from "@/lib/data/overlays";
import type { GameId } from "@/lib/data/games";
import styles from "./LiveOverlays.module.css";

// The OBS overlays as they'd actually look on stream, wired to the Play mode above: add a donation
// and the alert pops here; spin and this wheel spins. Same widgets the streamer drops into OBS —
// shown, not described.

export type OverlayEvent =
  | { kind: "donation"; name: string; amount: number; text: string }
  | { kind: "spin" }
  | { kind: "run" }
  | { kind: "result"; name: string; amount: number; text: string };

export function LiveOverlays({
  id,
  events,
  pot,
  goal,
  pools,
  running,
  winner,
}: {
  id: GameId;
  events: OverlayEvent[];
  pot: number;
  goal: number;
  pools: [string, number][];
  running: boolean;
  winner: string | null;
}) {
  // the newest donation drives the alert; it fades out on its own like the real overlay does
  const [alert, setAlert] = useState<{ name: string; amount: number; text: string; id: number } | null>(null);

  useEffect(() => {
    const last = events[events.length - 1];
    if (!last || last.kind !== "donation") return;
    const a = { name: last.name, amount: last.amount, text: last.text, id: events.length };
    setAlert(a);
    const t = setTimeout(() => setAlert((cur) => (cur?.id === a.id ? null : cur)), 3600);
    return () => clearTimeout(t);
  }, [events]);

  const pct = goal ? Math.min(100, Math.round((pot / goal) * 100)) : 0;
  const top = pools.slice(0, 3);

  // $1 donated = 1 reputation, so a donation that carries a viewer across a tier threshold fires the
  // rank-up overlay — the same rule the real one runs on.
  const ranker = (() => {
    const rep = new Map<string, number>();
    let last: { name: string; tier: string } | null = null;
    for (const e of events) {
      if (e.kind !== "donation") continue;
      const before = rep.get(e.name) ?? 0;
      const after = before + e.amount;
      rep.set(e.name, after);
      for (const t of OVERLAY_TIERS) {
        if (before < t.at && after >= t.at) last = { name: e.name, tier: t.name };
      }
    }
    return last;
  })();

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <span className={styles.title}>On your stream</span>
        <span className={styles.hint}>real overlays — they react as you play above</span>
      </div>

      <div className={styles.grid}>
        {/* alerts — pops on every donation */}
        <div className={styles.pane}>
          <span className={styles.paneTag}>Alerts</span>
          <div className={styles.screen}>
            {alert ? (
              <div key={alert.id} className={styles.alert}>
                <span className={styles.avatar} aria-hidden>
                  {alert.name[0]?.toUpperCase()}
                </span>
                <div className={styles.alertBody}>
                  <div className={styles.alertRow}>
                    <b className={styles.alertName}>{alert.name}</b>
                    <span className={styles.pill}>${alert.amount}</span>
                  </div>
                  {alert.text && <span className={styles.alertMsg}>{alert.text}</span>}
                </div>
              </div>
            ) : (
              <span className={styles.idle}>waiting for a donation…</span>
            )}
          </div>
        </div>

        {/* the game's own widget */}
        <div className={styles.pane}>
          <span className={styles.paneTag}>
            {id === "roulette" ? "Roulette" : id === "task" ? "Task" : id === "auction" ? "Auction" : "Fundraiser"}
          </span>
          <div className={styles.screen}>
            {pools.length === 0 ? (
              <span className={styles.idle}>nothing running yet…</span>
            ) : id === "auction" ? (
              <div className={styles.game}>
                <div className={styles.gameHead}>
                  <GameIcon id="auction" width={15} height={15} />
                  {winner ? "Sold" : running ? "Going once…" : "Bidding open"}
                  <span className={styles.gamePot}>
                    ${winner ? pools.find(([lbl]) => lbl === winner)?.[1] ?? 0 : top[0]?.[1] ?? 0} {winner ? "sold" : "leads"}
                  </span>
                </div>
                {winner ? (
                  <div className={styles.winnerBig}>“{winner}”</div>
                ) : (
                  top.map(([lbl, sum]) => (
                    <div className={styles.gameRow} key={lbl}>
                      <span className={styles.gameName}>{lbl}</span>
                      <span className={styles.gameBar}>
                        <span style={{ width: `${(sum / (top[0]?.[1] || 1)) * 100}%` }} />
                      </span>
                      <span className={styles.gamePct}>${sum}</span>
                    </div>
                  ))
                )}
              </div>
            ) : id === "roulette" ? (
              <div className={styles.game}>
                <div className={styles.gameHead}>
                  <GameIcon id="roulette" width={15} height={15} />
                  {winner ? "Winner" : running ? "Spinning" : "Round open"}
                  <span className={styles.gamePot}>${pot} pot</span>
                </div>
                {winner ? (
                  <div className={styles.winnerBig}>{winner}</div>
                ) : (
                  top.map(([lbl, sum]) => (
                    <div className={styles.gameRow} key={lbl}>
                      <span className={styles.gameName}>{lbl}</span>
                      <span className={styles.gameBar}>
                        <span style={{ width: `${(sum / pot) * 100}%` }} />
                      </span>
                      <span className={styles.gamePct}>{Math.round((sum / pot) * 100)}%</span>
                    </div>
                  ))
                )}
              </div>
            ) : id === "task" ? (
              <div className={styles.game}>
                <div className={styles.gameHead}>
                  <GameIcon id="task" width={15} height={15} />
                  {winner ? "Completed" : "Active task"}
                  <span className={styles.gamePot}>${pools[0][1]}</span>
                </div>
                <div className={styles.gameText}>“{pools[0][0]}”</div>
                <div className={styles.gameSub}>{winner ? "money released to you" : "counting down…"}</div>
              </div>
            ) : (
              <div className={styles.fund}>
                <FundraiserFill pct={pct / 100} size={52} />
                <div>
                  <div className={styles.fundPct}>{pct}%</div>
                  <div className={styles.fundNums}>
                    ${pot} of ${goal}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* rank-up — every donation earns reputation, so it fires for the newest donor */}
        <div className={styles.pane}>
          <span className={styles.paneTag}>Rank-up</span>
          <div className={styles.screen}>
            {ranker ? (
              <div className={styles.alert}>
                <span className={styles.crown} aria-hidden>
                  <CrownMark />
                </span>
                <div className={styles.rankLine}>
                  <b>{ranker.name}</b> reached <span className={styles.tier}>{ranker.tier}</span>
                </div>
              </div>
            ) : (
              <span className={styles.idle}>fires when a viewer levels up…</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
