"use client";

import { useEffect, useState } from "react";
import { GameIcon } from "@/components/icons";
import { readRound, readRoundMeta } from "@/lib/data/roulette";
import { readStatus, raisedTotal, withFundraiserDefaults } from "@/lib/data/fundraiser";
import { readTasks } from "@/lib/data/tasks";
import { readLots, readAuctionMeta, auctionTotals, lotSum } from "@/lib/data/auction";
import { firstActiveScope, firstActiveSession } from "@/lib/data/gameSessions";
import { pullScope } from "@/lib/data/gameSync";
import type { GameId } from "@/lib/data/games";
import type { Profile } from "@/lib/data/types";
import { usd } from "@/lib/money";
import styles from "./HomeLive.module.css";

interface Live {
  roulette: { pot: number; count: number; session: string | null } | null;
  fundraiser: { pledge: string; goal: number; raised: number; state: string; session: string | null } | null;
  tasks: { active: number; pending: number; texts: string[]; session: string | null } | null;
  auction: { state: string; top: number; pending: number; lots: number; topText: string; session: string | null } | null;
}

// The games that are running right now, surfaced on Home so the streamer sees them without
// digging into each game's Overview. Reads the same mock stores the Overview tabs write to,
// so it stays in step. Renders nothing until mounted (localStorage is client-only) and nothing
// when no game is live.
export function HomeLive({ profile, onOpen }: { profile: Profile; onOpen: (g: GameId) => void }) {
  const handle = profile.handle;
  const [live, setLive] = useState<Live | null>(null);

  useEffect(() => {
    // Each game reads its first live session (or the legacy bare handle if sessions were never used).
    const rlScope = firstActiveScope(handle, "roulette");
    const frScope = firstActiveScope(handle, "fundraiser");
    const tkScope = firstActiveScope(handle, "task");
    const auScope = firstActiveScope(handle, "auction");

    // The live session's own name, per game — shown on each card so the streamer knows WHICH run is
    // live (they can have several named runs). null when sessions were never used (legacy handle).
    const rlName = firstActiveSession(handle, "roulette")?.name ?? null;
    const frName = firstActiveSession(handle, "fundraiser")?.name ?? null;
    const tkName = firstActiveSession(handle, "task")?.name ?? null;
    const auName = firstActiveSession(handle, "auction")?.name ?? null;

    const load = () => {
      const round = readRound(rlScope);
      const meta = readRoundMeta(rlScope);
      const roulette = round.length > 0 && !meta?.winner ? { pot: round.reduce((s, r) => s + r.pool, 0), count: round.length, session: rlName } : null;

      const st = readStatus(frScope);
      const fr = withFundraiserDefaults(profile);
      const raised = raisedTotal(frScope);
      // "collecting" is also readStatus()'s default for a page that never ran one, so an untouched
      // account would otherwise show a fundraiser at $0 as if it were live. Delivering is always
      // real (something was accepted); collecting counts only once a backer has actually chipped in.
      const frLive = st.state === "delivering" || (st.state === "collecting" && raised > 0);
      const fundraiser = frLive ? { pledge: fr.pledge, goal: fr.goal, raised, state: st.state, session: frName } : null;

      const open = readTasks(tkScope).filter((t) => t.state === "pending" || t.state === "active");
      const tasks = open.length
        ? {
            active: open.filter((t) => t.state === "active").length,
            pending: open.filter((t) => t.state === "pending").length,
            texts: open.slice(0, 2).map((t) => t.text),
            session: tkName,
          }
        : null;

      const am = readAuctionMeta(auScope);
      const at = auctionTotals(readLots(auScope));
      const auction =
        am && am.state !== "settled" && am.state !== "refunded" && am.state !== "cancelled" && (at.accepted > 0 || at.pending > 0)
          ? { state: am.state, top: at.top ? lotSum(at.top) : 0, pending: at.pending, lots: at.accepted, topText: at.top?.text ?? "", session: auName }
          : null;

      setLive({ roulette, fundraiser, tasks, auction });
    };

    // The dashboard is where the streamer LANDS — pull the shared game state so viewers' tasks,
    // backings and bids from other browsers show here too, not only after opening a game tab.
    load();
    let dead = false;
    const scopes = [...new Set([rlScope, frScope, tkScope, auScope])];
    const sync = () => Promise.all(scopes.map((s) => pullScope(s))).then(() => !dead && load());
    void sync();
    const t = setInterval(() => void sync(), 5000);
    return () => {
      dead = true;
      clearInterval(t);
    };
  }, [handle, profile]);

  if (!live) return null;

  // Nothing running: keep the section, say so plainly, and point at the next step. An empty screen
  // with no explanation is indistinguishable from a broken one.
  if (!live.roulette && !live.fundraiser && !live.tasks && !live.auction) {
    return (
      <section>
        <div className={styles.head}>Live now</div>
        <div className={styles.empty}>
          <div className={styles.emptyIcons} aria-hidden>
            {(["roulette", "task", "fundraiser", "auction"] as GameId[]).map((id) => (
              <span className={styles.emptyIcon} key={id}>
                <GameIcon id={id} width={18} height={18} />
              </span>
            ))}
          </div>
          <div className={styles.emptyText}>No game is running right now.</div>
          <button type="button" className="btn-outline" onClick={() => onOpen("roulette")}>
            Start one
          </button>
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className={styles.head}>Live now</div>
      <div className={styles.grid}>
        {live.roulette && (
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <GameIcon id="roulette" width={18} height={18} />
              <span className={styles.cardTitle}>Roulette</span>
              {live.roulette.session && <span className={styles.cardSession}>· {live.roulette.session}</span>}
              <span className="pill ok" style={{ marginLeft: "auto" }}>
                <span className="dot" />
                Round open
              </span>
            </div>
            <div className={styles.stat}>
              <b className="num">{usd(live.roulette.pot)}</b> in the pot · {live.roulette.count} suggestions
            </div>
            <div className={styles.spacer} />
            <button type="button" className="btn-outline" style={{ alignSelf: "flex-start" }} onClick={() => onOpen("roulette")}>
              Manage round
            </button>
          </div>
        )}

        {live.fundraiser && (
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <GameIcon id="fundraiser" width={18} height={18} />
              <span className={styles.cardTitle}>Fundraiser</span>
              {live.fundraiser.session && <span className={styles.cardSession}>· {live.fundraiser.session}</span>}
              <span className={`pill ${live.fundraiser.state === "delivering" ? "attn" : "ok"}`} style={{ marginLeft: "auto" }}>
                <span className="dot" />
                {live.fundraiser.state === "delivering" ? "Delivering" : "Collecting"}
              </span>
            </div>
            {live.fundraiser.pledge && <div className={styles.pledge}>{live.fundraiser.pledge}</div>}
            <div className={styles.bar}>
              <div className={styles.barFill} style={{ width: `${Math.min(100, Math.round((live.fundraiser.raised / live.fundraiser.goal) * 100))}%` }} />
            </div>
            <div className={styles.stat}>
              <b className="num">{usd(live.fundraiser.raised)}</b> of {usd(live.fundraiser.goal)} ·{" "}
              {Math.min(100, Math.round((live.fundraiser.raised / live.fundraiser.goal) * 100))}%
            </div>
            <div className={styles.spacer} />
            <button type="button" className="btn-outline" style={{ alignSelf: "flex-start" }} onClick={() => onOpen("fundraiser")}>
              Manage fundraiser
            </button>
          </div>
        )}

        {live.tasks && (
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <GameIcon id="task" width={18} height={18} />
              <span className={styles.cardTitle}>Tasks</span>
              {live.tasks.session && <span className={styles.cardSession}>· {live.tasks.session}</span>}
              <span className={`pill ${live.tasks.pending ? "attn" : "ok"}`} style={{ marginLeft: "auto" }}>
                <span className="dot" />
                {live.tasks.pending ? `${live.tasks.pending} awaiting` : `${live.tasks.active} running`}
              </span>
            </div>
            <div className={styles.stat}>
              <b className="num">{live.tasks.active}</b> running · <b className="num">{live.tasks.pending}</b> awaiting you
            </div>
            <div className={styles.tlist}>
              {live.tasks.texts.map((t, i) => (
                <div key={i} className={styles.titem}>
                  {t}
                </div>
              ))}
            </div>
            <div className={styles.spacer} />
            <button type="button" className="btn-outline" style={{ alignSelf: "flex-start" }} onClick={() => onOpen("task")}>
              Manage tasks
            </button>
          </div>
        )}
        {live.auction && (
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <GameIcon id="auction" width={18} height={18} />
              <span className={styles.cardTitle}>Auction</span>
              {live.auction.session && <span className={styles.cardSession}>· {live.auction.session}</span>}
              <span className={`pill ${live.auction.pending ? "attn" : "ok"}`} style={{ marginLeft: "auto" }}>
                <span className="dot" />
                {live.auction.state === "bidding"
                  ? live.auction.pending
                    ? `${live.auction.pending} to review`
                    : "Bidding"
                  : live.auction.state === "performing"
                    ? "Deliver it"
                    : "Voting"}
              </span>
            </div>
            <div className={styles.stat}>
              <b className="num">{usd(live.auction.top)}</b> leading lot · {live.auction.lots} in play
            </div>
            {live.auction.topText && (
              <div className={styles.tlist}>
                <div className={styles.titem}>{live.auction.topText}</div>
              </div>
            )}
            <div className={styles.spacer} />
            <button type="button" className="btn-outline" style={{ alignSelf: "flex-start" }} onClick={() => onOpen("auction")}>
              Manage auction
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
