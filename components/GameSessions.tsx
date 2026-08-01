"use client";

import { useCallback, useEffect, useState } from "react";
import {
  readSessions,
  createSession,
  endSession,
  sessionState,
  setCurrentSession,
  getCurrentSession,
  type GameSession,
} from "@/lib/data/gameSessions";
import { readLots, readAuctionMeta, initAuction, setAuctionChain, leaderboard, lotSum, auctionTotals, PLATFORM_MIN_BID } from "@/lib/data/auction";
import { readRound, readRoundMeta, initRound } from "@/lib/data/roulette";
import { readStatus, raisedTotal, writeStatus } from "@/lib/data/fundraiser";
import { useGameChain } from "@/lib/chain/useGameChain";
import { fundingCreateCollection, auctionCreate } from "@/lib/chain/gameFlows";
import { DEFAULT_FUNDRAISER_CONFIG } from "@/components/FundraiserGameSettings";
import { readTasks } from "@/lib/data/tasks";
import { DEFAULT_AUCTION_CONFIG } from "@/components/AuctionGameSettings";
import type { Tier } from "@/lib/data/types";
import type { GameId } from "@/lib/data/games";
import { usd } from "@/lib/money";

// One line that tells the streamer what's inside a session without opening it.
function summarize(s: GameSession): string {
  switch (s.gameId) {
    case "auction": {
      const lots = readLots(s.scope);
      const t = auctionTotals(lots);
      const m = readAuctionMeta(s.scope);
      if (m?.state === "settled") return `paid out · ${usd(t.top ? lotSum(t.top) : 0)}`;
      if (m?.state === "refunded") return "refunded";
      if (m?.state === "cancelled") return "cancelled";
      if (m?.state === "performing") return "delivering the winning lot";
      if (m?.state === "voting") return "voting";
      return t.accepted ? `${usd(t.top ? lotSum(t.top) : 0)} leading · ${t.accepted} lot${t.accepted > 1 ? "s" : ""}${t.pending ? ` · ${t.pending} to review` : ""}` : t.pending ? `${t.pending} lot${t.pending > 1 ? "s" : ""} to review` : "no lots yet";
    }
    case "roulette": {
      const round = readRound(s.scope);
      const winner = readRoundMeta(s.scope)?.winner;
      if (winner) return `spun · ${winner.title} won`;
      const pot = round.reduce((sum, r) => sum + r.pool, 0);
      return round.length ? `${usd(pot)} in the pot · ${round.length} suggestions` : "empty wheel";
    }
    case "fundraiser": {
      const st = readStatus(s.scope).state;
      const raised = raisedTotal(s.scope);
      if (st === "delivered") return `delivered · ${usd(raised)}`;
      if (st === "refunded") return "refunded";
      return `${usd(raised)} collected${st === "delivering" ? " · delivering" : ""}`;
    }
    case "task": {
      const open = readTasks(s.scope).filter((t) => t.state === "pending" || t.state === "active");
      return open.length ? `${open.length} task${open.length > 1 ? "s" : ""} open` : "queue empty";
    }
  }
}

function when(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// The Sessions tab — one per game in the cabinet. A session is one run of the game: start as
// many as you like in parallel, each with its own board/round/queue and its own share link;
// a finished game switches its session off by itself and stays here as the archive.
export function GameSessions({
  fundraiserGoal: profileGoal,
  handle,
  gameId,
  gameTitle,
  tiers = [],
  onOpen,
  onCreated,
}: {
  fundraiserGoal?: number;
  handle: string;
  gameId: GameId;
  gameTitle: string;
  tiers?: Tier[]; // the streamer's rank ladder — roulette's rank mode picks its gate from it
  onOpen: (sessionId: string) => void; // opening an existing session → its control room
  onCreated?: (sessionId: string) => void; // a fresh session → the Page tab, to set it up and share
}) {
  const [chainErr, setChainErr] = useState("");
  // The chain gate for the two canister-backed creates (roulette has no canister by design).
  const chain = useGameChain(gameId === "fundraiser" ? "fundraiser" : gameId === "auction" ? "auction" : "task");
  // The collection's goal/duration come from the streamer's own fundraiser draft + config.
  const profileCfg = () => {
    const goal = profileGoal ?? DEFAULT_FUNDRAISER_CONFIG.minContribution * 200;
    return { goal, days: DEFAULT_FUNDRAISER_CONFIG.fundingDays };
  };
  const [sessions, setSessions] = useState<GameSession[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [minBid, setMinBid] = useState(String(DEFAULT_AUCTION_CONFIG.minBid)); // auction only: the opening price
  // roulette only: who suggests — everyone by donating (classic), or rank X+ for free
  const [rankMode, setRankMode] = useState(false);
  const [minTier, setMinTier] = useState("");
  const [origin, setOrigin] = useState("");

  const refresh = useCallback(() => {
    setSessions(readSessions(handle, gameId));
    setCurrentId(getCurrentSession(handle, gameId)?.id ?? null);
  }, [handle, gameId]);

  useEffect(() => {
    refresh();
    setOrigin(window.location.origin);
    const t = setInterval(refresh, 2000); // live/finished is computed — keep the pills honest
    return () => clearInterval(t);
  }, [refresh]);

  async function start() {
    setChainErr("");
    const floor = Math.max(PLATFORM_MIN_BID, Math.round(Number(minBid)) || PLATFORM_MIN_BID);

    // Canister-live games are born ON the canister first — a session without its chain id
    // would take real escrows it can never resolve. Mock stays untouched when gates are off.
    let chainCollection: string | undefined;
    let chainAuction: string | undefined;
    if (chain.live && (gameId === "fundraiser" || gameId === "auction")) {
      if (!chain.wallet) {
        setChainErr("Connect your wallet — this game is live on the canister.");
        return;
      }
      if (gameId === "fundraiser") {
        const cfg = profileCfg();
        const res = await fundingCreateCollection(chain.wallet, { goalDollars: cfg.goal, durationDays: cfg.days });
        if (!res.ok) {
          setChainErr(res.error);
          return;
        }
        chainCollection = res.collectionHex;
      }
      if (gameId === "auction") {
        const res = await auctionCreate(chain.wallet, {
          durationHours: DEFAULT_AUCTION_CONFIG.biddingHours,
          performHours: DEFAULT_AUCTION_CONFIG.performHours,
          minEntryDollars: floor,
        });
        if (!res.ok) {
          setChainErr(res.error);
          return;
        }
        chainAuction = res.auctionHex;
      }
    }

    const s = createSession(handle, gameId, name);
    // The auction's opening price is fixed the moment it's born — the streamer's number,
    // clamped to the platform floor the admin set.
    if (gameId === "auction") {
      initAuction(s.scope, floor);
      if (chainAuction) setAuctionChain(s.scope, chainAuction);
    }
    if (gameId === "fundraiser" && chainCollection) writeStatus(s.scope, { state: "collecting", chainCollection });
    // The roulette round's mode is fixed the same way: rank mode pins the tier gate forever.
    if (gameId === "roulette" && rankMode) initRound(s.scope, { mode: "rank", minTier: minTier || tiers[0]?.name });
    setName("");
    refresh();
    (onCreated ?? onOpen)(s.id);
  }

  const live = sessions.filter((s) => sessionState(s) === "live");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 style={{ fontSize: 16 }}>Start a session</h2>
        <div className="footnote">
          A session is one run of {gameTitle} with its own board and its own link — run several at once if you like.
          When a game reaches its verdict, its session switches off by itself.
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div className="field" style={{ flex: 1, minWidth: 200 }}>
            <input
              type="text"
              placeholder={`Name it (optional) — “Friday ${gameTitle.toLowerCase()}”`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && start()}
            />
          </div>
          {gameId === "auction" && (
            <div className="field" style={{ flex: "0 0 118px" }} title="Opening price — the first lot starts here">
              <div className="affix has-pre">
                <span className="affix-pre">$</span>
                <input
                  type="number"
                  min={PLATFORM_MIN_BID}
                  aria-label="Minimum bid"
                  value={minBid}
                  onChange={(e) => setMinBid(e.target.value)}
                />
              </div>
            </div>
          )}
          <button className="btn" type="button" onClick={() => void start()}>
            Start
          </button>
          {chainErr && (
            <div className="footnote" style={{ color: "var(--error)" }}>
              {chainErr}
            </div>
          )}
        </div>
        {gameId === "auction" && (
          <div className="footnote">Platform minimum: {usd(PLATFORM_MIN_BID)} — set by the admin, no auction opens below it.</div>
        )}
        {gameId === "roulette" && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <label className={`toggle${rankMode ? " on" : ""}`}>
              <span className="track">
                <span className="knob" />
              </span>
              <input type="checkbox" hidden checked={rankMode} onChange={(e) => setRankMode(e.target.checked)} />
              Suggestions by rank, not by donation
            </label>
            {rankMode && (
              <select
                className="chip"
                style={{ height: 40, padding: "0 12px", borderRadius: "var(--r-2)", background: "var(--bg-0)" }}
                value={minTier}
                onChange={(e) => setMinTier(e.target.value)}
                aria-label="Minimum rank to suggest"
              >
                {tiers.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name}+
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
        {gameId === "roulette" && rankMode && (
          <div className="footnote">Viewers at this rank and above put games on the wheel for free — backing stays open to everyone.</div>
        )}
      </div>

      {sessions.length === 0 && <div className="empty-log">No sessions yet — start the first one above.</div>}

      {live.length > 0 && (
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 style={{ fontSize: 16 }}>Live</h2>
          {live.map((s) => (
            <div key={s.id} className="panel" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", flexWrap: "wrap" }}>
              <span className="pill ok">
                <span className="dot" />
                live
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>
                  {s.name}
                  {s.id === currentId && (
                    <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: "var(--accent)" }}>selected</span>
                  )}
                </div>
                <div className="footnote">
                  {summarize(s)} · started {when(s.createdAt)}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="btn-outline" type="button" onClick={() => { setCurrentSession(handle, gameId, s.id); onOpen(s.id); }}>
                  Open
                </button>
                <button
                  className="btn-outline"
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(`${origin}/@${handle}/${gameId}?s=${s.id}`);
                    } catch {}
                  }}
                  title="Copy this session's public link"
                >
                  Copy link
                </button>
                <button
                  className="btn-outline"
                  type="button"
                  onClick={() => {
                    setSessions(endSession(handle, gameId, s.id));
                    refresh();
                  }}
                >
                  End
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

    </div>
  );
}

// The thin switcher above Overview when more than one session is live — pick which one the tab
// is looking at without leaving it.
export function SessionBar({
  handle,
  gameId,
  currentId,
  onSwitch,
}: {
  handle: string;
  gameId: GameId;
  currentId: string | null;
  onSwitch: (id: string) => void;
}) {
  const [sessions, setSessions] = useState<GameSession[]>([]);
  useEffect(() => {
    const load = () => setSessions(readSessions(handle, gameId).filter((s) => sessionState(s) === "live"));
    load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [handle, gameId]);

  if (sessions.length < 2) return null;
  return (
    <div className="chips" style={{ marginBottom: 4 }}>
      {sessions.map((s) => (
        <button
          key={s.id}
          type="button"
          className={`chip${s.id === currentId ? " active" : ""}`}
          onClick={() => {
            setCurrentSession(handle, gameId, s.id);
            onSwitch(s.id);
          }}
        >
          {s.name}
        </button>
      ))}
    </div>
  );
}
