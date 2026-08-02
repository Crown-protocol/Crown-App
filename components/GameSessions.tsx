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
import { readLots, readAuctionMeta, initAuction, setAuctionChain, lotSum, auctionTotals, PLATFORM_MIN_BID } from "@/lib/data/auction";
import { readRound, readRoundMeta, initRound } from "@/lib/data/roulette";
import { readStatus, raisedTotal, writeStatus } from "@/lib/data/fundraiser";
import { readTasks } from "@/lib/data/tasks";
import { useGameChain } from "@/lib/chain/useGameChain";
import { fundingCreateCollection, auctionCreate } from "@/lib/chain/gameFlows";
import {
  auctionRules,
  fundraiserRules,
  rouletteRules,
  taskRules,
  writeSessionRules,
  type FundraiserSessionRules,
} from "@/lib/data/gameConfig";
import { DEADLINE_OPTIONS } from "@/components/TaskGameSettings";
import { BIDDING_OPTIONS, PERFORM_OPTIONS } from "@/components/AuctionGameSettings";
import { FUNDING_OPTIONS, DELIVERY_OPTIONS } from "@/components/FundraiserGameSettings";
import { ROUND_OPTIONS, PLAY_OPTIONS } from "@/components/RouletteGameSettings";
import { ROULETTE_TOPICS, DEFAULT_TOPIC_ID, topicById } from "@/lib/data/roulette-topics";
import { NumberInput } from "@/components/NumberInput";
import { hoursText, daysText, minutesText } from "@/components/RulesSummary";
import type { AuctionConfig, Profile, RouletteConfig, TaskGameConfig } from "@/lib/data/types";
import type { GameId } from "@/lib/data/games";
import { usd } from "@/lib/money";
import s from "./GameSessions.module.css";

// One line that tells the streamer what's inside a session without opening it.
function summarize(session: GameSession): string {
  switch (session.gameId) {
    case "auction": {
      const lots = readLots(session.scope);
      const t = auctionTotals(lots);
      const m = readAuctionMeta(session.scope);
      if (m?.state === "settled") return `paid out · ${usd(t.top ? lotSum(t.top) : 0)}`;
      if (m?.state === "refunded") return "refunded";
      if (m?.state === "cancelled") return "cancelled";
      if (m?.state === "performing") return "delivering the winning lot";
      if (m?.state === "voting") return "voting";
      return t.accepted ? `${usd(t.top ? lotSum(t.top) : 0)} leading · ${t.accepted} lot${t.accepted > 1 ? "s" : ""}${t.pending ? ` · ${t.pending} to review` : ""}` : t.pending ? `${t.pending} lot${t.pending > 1 ? "s" : ""} to review` : "no lots yet";
    }
    case "roulette": {
      const round = readRound(session.scope);
      const winner = readRoundMeta(session.scope)?.winner;
      if (winner) return `spun · ${winner.title} won`;
      const pot = round.reduce((sum, r) => sum + r.pool, 0);
      return round.length ? `${usd(pot)} in the pot · ${round.length} suggestions` : "empty wheel";
    }
    case "fundraiser": {
      const st = readStatus(session.scope).state;
      const raised = raisedTotal(session.scope);
      if (st === "delivered") return `delivered · ${usd(raised)}`;
      if (st === "refunded") return "refunded";
      return `${usd(raised)} collected${st === "delivering" ? " · delivering" : ""}`;
    }
    case "task": {
      const open = readTasks(session.scope).filter((t) => t.state === "pending" || t.state === "active");
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
//
// Starting one is where its RULES are set. They open on the maker's standing defaults (Settings →
// the game's rules), and whatever they're changed to is pinned to this run alone — so a Friday
// auction can open at $50 while the weekday one stays at $5, and editing the defaults later can
// never move the goalposts under money already in escrow. See lib/data/gameConfig.ts.
export function GameSessions({
  profile,
  gameId,
  gameTitle,
  onOpen,
  onCreated,
}: {
  profile: Profile;
  gameId: GameId;
  gameTitle: string;
  onOpen: (sessionId: string) => void; // opening an existing session → its control room
  onCreated?: (sessionId: string) => void; // a fresh session → the Page tab, to set it up and share
}) {
  const handle = profile.handle;
  const tiers = profile.tiers ?? [];
  const [chainErr, setChainErr] = useState("");
  // The chain gate for the two canister-backed creates (roulette has no canister by design).
  const chain = useGameChain(gameId === "fundraiser" ? "fundraiser" : gameId === "auction" ? "auction" : "task");
  const [sessions, setSessions] = useState<GameSession[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [origin, setOrigin] = useState("");

  // The rules this run will open with — one state per game, seeded from the maker's standing
  // defaults (scope `null` = "stop at the profile", gameConfig.ts).
  const [task, setTask] = useState<TaskGameConfig>(() => taskRules(profile, null));
  const [roul, setRoul] = useState<RouletteConfig>(() => rouletteRules(profile, null));
  const [fund, setFund] = useState<FundraiserSessionRules>(() => fundraiserRules(profile, null));
  const [auc, setAuc] = useState<AuctionConfig>(() => auctionRules(profile, null));
  // roulette only: who suggests — everyone by donating (classic), or rank X+ for free.
  const [rankMode, setRankMode] = useState(false);

  const resetRules = useCallback(() => {
    setTask(taskRules(profile, null));
    setRoul(rouletteRules(profile, null));
    setFund(fundraiserRules(profile, null));
    setAuc(auctionRules(profile, null));
    setRankMode(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  // Switching games in the cabinet re-seeds the form. Deliberately NOT keyed on `profile`: it's
  // saved on every keystroke elsewhere in the cabinet, and re-seeding then would yank the knobs
  // out from under whoever is setting them here.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(resetRules, [gameId]);

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

  const topic = topicById(roul.topic ?? DEFAULT_TOPIC_ID);
  const bidFloor = Math.max(PLATFORM_MIN_BID, Math.round(auc.minBid) || PLATFORM_MIN_BID);

  async function start() {
    setChainErr("");

    // Canister-live games are born ON the canister first — a session without its chain id
    // would take real escrows it can never resolve. Mock stays untouched when gates are off.
    // The numbers handed over are THIS session's, not the profile's: the canister is where they
    // become binding, so the two must be the same numbers.
    let chainCollection: string | undefined;
    let chainAuction: string | undefined;
    if (chain.live && (gameId === "fundraiser" || gameId === "auction")) {
      if (!chain.wallet) {
        setChainErr("Connect your wallet — this game is live on the canister.");
        return;
      }
      if (gameId === "fundraiser") {
        const res = await fundingCreateCollection(chain.wallet, { goalDollars: fund.goal, durationDays: fund.fundingDays });
        if (!res.ok) {
          setChainErr(res.error);
          return;
        }
        chainCollection = res.collectionHex;
      }
      if (gameId === "auction") {
        const res = await auctionCreate(chain.wallet, {
          durationHours: auc.biddingHours,
          performHours: auc.performHours,
          minEntryDollars: bidFloor,
        });
        if (!res.ok) {
          setChainErr(res.error);
          return;
        }
        chainAuction = res.auctionHex;
      }
    }

    const session = createSession(handle, gameId, name);

    // Pin the rules to this run before anything can be played under them.
    if (gameId === "task") writeSessionRules(session.scope, "task", task);
    if (gameId === "fundraiser") writeSessionRules(session.scope, "fundraiser", fund);
    if (gameId === "auction") writeSessionRules(session.scope, "auction", { ...auc, minBid: bidFloor });
    if (gameId === "roulette") writeSessionRules(session.scope, "roulette", roul);

    // The auction's opening price is fixed the moment it's born — the streamer's number,
    // clamped to the platform floor the admin set.
    if (gameId === "auction") {
      initAuction(session.scope, bidFloor);
      if (chainAuction) setAuctionChain(session.scope, chainAuction);
    }
    if (gameId === "fundraiser" && chainCollection) writeStatus(session.scope, { state: "collecting", chainCollection });
    // The round's mode and format are fixed the same way — pinned for the whole run.
    if (gameId === "roulette") {
      initRound(session.scope, {
        mode: rankMode ? "rank" : "donate",
        minTier: roul.minTier || undefined,
        format: roul.format ?? "single",
      });
    }
    setName("");
    refresh();
    (onCreated ?? onOpen)(session.id);
  }

  const live = sessions.filter((x) => sessionState(x) === "live");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className={`card ${s.starter}`}>
        <div className={s.head}>
          <h2>Start a session</h2>
          <p>One run of {gameTitle} — its own board, its own link, and the rules you set here.</p>
        </div>

        <div className="field">
          <label htmlFor="sess-name">Name</label>
          <input
            id="sess-name"
            type="text"
            placeholder={`Optional — “Friday ${gameTitle.toLowerCase()}”`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void start()}
          />
        </div>

        {gameId === "task" && (
          <>
            <div className={s.group}>
              <div className={s.grid}>
                <div className="field">
                  <label htmlFor="sess-task-min">Minimum task amount</label>
                  <div className="affix has-pre">
                    <span className="affix-pre">$</span>
                    <NumberInput id="sess-task-min" min={1} value={task.minAmount} onCommit={(n) => setTask({ ...task, minAmount: n })} />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="sess-task-max">Max active tasks</label>
                  <NumberInput id="sess-task-max" min={1} max={50} value={task.maxActiveTasks} onCommit={(n) => setTask({ ...task, maxActiveTasks: n })} />
                </div>
              </div>
            </div>

            <div className={s.group}>
              <div className={s.grid}>
                <div className="field">
                  <label htmlFor="sess-task-deadline">Longest deadline a viewer may pick</label>
                  <select id="sess-task-deadline" value={task.deadlineHours} onChange={(e) => setTask({ ...task, deadlineHours: +e.target.value })}>
                    {DEADLINE_OPTIONS.map((o) => (
                      <option key={o.hours} value={o.hours}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className={s.toggleRow}>
                <label className={`toggle${task.requireApproval ? " on" : ""}`}>
                  <span className="track">
                    <span className="knob" />
                  </span>
                  <input type="checkbox" hidden checked={task.requireApproval} onChange={(e) => setTask({ ...task, requireApproval: e.target.checked })} />
                  Require your approval before the clock starts
                </label>
              </div>
            </div>

            <p className={s.practice}>
              A viewer pays from {usd(task.minAmount)} and picks a deadline of up to {hoursText(task.deadlineHours)}.{" "}
              {task.requireApproval ? "You accept the task first, then the clock starts." : "The clock starts the moment they pay."}{" "}
              Up to {task.maxActiveTasks} {task.maxActiveTasks === 1 ? "task runs" : "tasks run"} at once. Miss the deadline and they get their money back.
            </p>
          </>
        )}

        {gameId === "roulette" && (
          <>
            <div className={s.group}>
              <div className={s.grid}>
                <div className="field">
                  <label htmlFor="sess-roul-min">Minimum to suggest</label>
                  <div className="affix has-pre">
                    <span className="affix-pre">$</span>
                    <NumberInput id="sess-roul-min" min={1} value={roul.minDonation} onCommit={(n) => setRoul({ ...roul, minDonation: n })} />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="sess-roul-topic">Topic</label>
                  <select
                    id="sess-roul-topic"
                    value={roul.topic ?? DEFAULT_TOPIC_ID}
                    onChange={(e) => setRoul({ ...roul, topic: e.target.value, genres: [] })}
                  >
                    {ROULETTE_TOPICS.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="sess-roul-format">Spin format</label>
                  <select id="sess-roul-format" value={roul.format ?? "single"} onChange={(e) => setRoul({ ...roul, format: e.target.value as "single" | "elimination" })}>
                    <option value="single">Single spin</option>
                    <option value="elimination">Elimination</option>
                  </select>
                </div>
              </div>
            </div>

            <div className={s.group}>
              <div className={s.toggles}>
                <div className={s.toggleRow}>
                  <label className={`toggle${rankMode ? " on" : ""}`}>
                    <span className="track">
                      <span className="knob" />
                    </span>
                    <input
                      type="checkbox"
                      hidden
                      checked={rankMode}
                      onChange={(e) => {
                        setRankMode(e.target.checked);
                        // Rank mode is meaningless without a rank — fall to the lowest tier.
                        if (e.target.checked && !roul.minTier) setRoul({ ...roul, minTier: tiers[0]?.name ?? "" });
                      }}
                    />
                    Suggestions by rank, not by donation
                  </label>
                </div>
                <div className={s.grid}>
                  <div className="field">
                    <label htmlFor="sess-roul-tier">{rankMode ? "Minimum rank to suggest" : "Minimum tier to suggest"}</label>
                    <select id="sess-roul-tier" value={roul.minTier} onChange={(e) => setRoul({ ...roul, minTier: e.target.value })}>
                      {!rankMode && <option value="">Everyone</option>}
                      {tiers.map((t) => (
                        <option key={t.name} value={t.name}>
                          {t.name}+
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className={s.toggleRow}>
                  <label className={`toggle${roul.excludeTopTier ? " on" : ""}`}>
                    <span className="track">
                      <span className="knob" />
                    </span>
                    <input type="checkbox" hidden checked={roul.excludeTopTier} onChange={(e) => setRoul({ ...roul, excludeTopTier: e.target.checked })} />
                    Exclude my top tier
                  </label>
                </div>
              </div>
            </div>

            <div className={s.group}>
              <div className={s.grid}>
                <div className="field">
                  <label htmlFor="sess-roul-round">Round length</label>
                  <select id="sess-roul-round" value={roul.roundMinutes} onChange={(e) => setRoul({ ...roul, roundMinutes: +e.target.value })}>
                    {ROUND_OPTIONS.map((o) => (
                      <option key={o.minutes} value={o.minutes}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="sess-roul-play">Play time for the winner</label>
                  <select id="sess-roul-play" value={roul.playMinutes} onChange={(e) => setRoul({ ...roul, playMinutes: +e.target.value })}>
                    {PLAY_OPTIONS.map((o) => (
                      <option key={o.minutes} value={o.minutes}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <p className={s.practice}>
              {rankMode
                ? `${roul.minTier || tiers[0]?.name || "Ranked"}+ viewers put a ${topic.noun} on the wheel for free`
                : `${roul.minTier ? `${roul.minTier}+ viewers` : "Anyone"} can back a ${topic.noun} from ${usd(roul.minDonation)}`}
              {roul.excludeTopTier ? " (except your top tier)" : ""}. Suggestions stay open {minutesText(roul.roundMinutes)}, then{" "}
              {roul.format === "elimination" ? "the wheel spins until one is left" : "one spin picks the winner"} — the more money behind a{" "}
              {topic.noun}, the better its odds. You play it for {minutesText(roul.playMinutes)}. Money on the {topic.noun}s that don&apos;t win
              stays donated.
            </p>
          </>
        )}

        {gameId === "fundraiser" && (
          <>
            <div className={s.group}>
              <div className={s.grid}>
                <div className="field">
                  <label htmlFor="sess-fr-goal">Goal</label>
                  <div className="affix has-pre">
                    <span className="affix-pre">$</span>
                    <NumberInput id="sess-fr-goal" min={1} value={fund.goal} onCommit={(n) => setFund({ ...fund, goal: n })} />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="sess-fr-min">Minimum chip-in</label>
                  <div className="affix has-pre">
                    <span className="affix-pre">$</span>
                    <NumberInput id="sess-fr-min" min={1} value={fund.minContribution} onCommit={(n) => setFund({ ...fund, minContribution: n })} />
                  </div>
                </div>
                {fund.allowBelowGoal && (
                  <div className="field">
                    <label htmlFor="sess-fr-accept">Accept from</label>
                    <div className="affix has-suf">
                      <NumberInput id="sess-fr-accept" min={1} max={100} value={fund.minAcceptPct} onCommit={(n) => setFund({ ...fund, minAcceptPct: n })} />
                      <span className="affix-suf">%</span>
                    </div>
                    <p className={s.hint}>= {usd(Math.round((fund.goal * fund.minAcceptPct) / 100))} of your {usd(fund.goal)} goal.</p>
                  </div>
                )}
              </div>
              <div className={s.toggleRow}>
                <label className={`toggle${fund.allowBelowGoal ? " on" : ""}`}>
                  <span className="track">
                    <span className="knob" />
                  </span>
                  <input type="checkbox" hidden checked={fund.allowBelowGoal} onChange={(e) => setFund({ ...fund, allowBelowGoal: e.target.checked })} />
                  Allow closing below the goal
                </label>
              </div>
            </div>

            <div className={s.group}>
              <div className={s.grid}>
                <div className="field">
                  <label htmlFor="sess-fr-funding">Collection runs for</label>
                  <select id="sess-fr-funding" value={fund.fundingDays} onChange={(e) => setFund({ ...fund, fundingDays: +e.target.value })}>
                    {FUNDING_OPTIONS.map((o) => (
                      <option key={o.days} value={o.days}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="sess-fr-delivery">Time to deliver</label>
                  <select id="sess-fr-delivery" value={fund.deliveryDays} onChange={(e) => setFund({ ...fund, deliveryDays: +e.target.value })}>
                    {DELIVERY_OPTIONS.map((o) => (
                      <option key={o.days} value={o.days}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <p className={s.practice}>
              Backers chip in from {usd(fund.minContribution)} toward {usd(fund.goal)} for {daysText(fund.fundingDays)}.{" "}
              {fund.allowBelowGoal
                ? `You can accept once ${fund.minAcceptPct}% of the goal is in;`
                : "You can only accept once the full goal is in;"}{" "}
              after that you have {daysText(fund.deliveryDays)} to deliver. Don&apos;t, and every backer is refunded in full.
            </p>
          </>
        )}

        {gameId === "auction" && (
          <>
            <div className={s.group}>
              <div className={s.grid}>
                <div className="field">
                  <label htmlFor="sess-au-min">Opening price</label>
                  <div className="affix has-pre">
                    <span className="affix-pre">$</span>
                    <NumberInput id="sess-au-min" min={PLATFORM_MIN_BID} value={auc.minBid} onCommit={(n) => setAuc({ ...auc, minBid: n })} />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="sess-au-inc">Minimum outbid step</label>
                  <div className="affix has-pre">
                    <span className="affix-pre">$</span>
                    <NumberInput id="sess-au-inc" min={1} value={auc.minIncrement ?? 1} onCommit={(n) => setAuc({ ...auc, minIncrement: n })} />
                  </div>
                </div>
              </div>
              <p className={s.hint}>Platform minimum: {usd(PLATFORM_MIN_BID)} — set by the admin, no auction opens below it.</p>
            </div>

            <div className={s.group}>
              <div className={s.grid}>
                <div className="field">
                  <label htmlFor="sess-au-dur">Bidding window</label>
                  <select id="sess-au-dur" value={auc.biddingHours} onChange={(e) => setAuc({ ...auc, biddingHours: +e.target.value })}>
                    {BIDDING_OPTIONS.map((o) => (
                      <option key={o.hours} value={o.hours}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="sess-au-perf">Time to deliver</label>
                  <select id="sess-au-perf" value={auc.performHours} onChange={(e) => setAuc({ ...auc, performHours: +e.target.value })}>
                    {PERFORM_OPTIONS.map((o) => (
                      <option key={o.hours} value={o.hours}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <p className={s.practice}>
              Bids open at {usd(bidFloor)} and each outbid must beat the leader by at least {usd(auc.minIncrement ?? 1)}, running for{" "}
              {hoursText(auc.biddingHours)}. When it closes, everyone who didn&apos;t win is refunded, and you have{" "}
              {hoursText(auc.performHours)} to deliver — the winner&apos;s money reaches you only after that&apos;s confirmed.
            </p>
          </>
        )}

        <div className={s.foot}>
          <button className="btn" type="button" onClick={() => void start()}>
            Start session
          </button>
          <button className={s.reset} type="button" onClick={resetRules}>
            Reset to my defaults
          </button>
          {chainErr && <div className={s.err}>{chainErr}</div>}
        </div>
      </div>

      {sessions.length === 0 && <div className="empty-log">No sessions yet — start the first one above.</div>}

      {live.length > 0 && (
        <div className={`card ${s.list}`}>
          <h2>Live</h2>
          {live.map((session) => (
            <div key={session.id} className={`panel ${s.row}`}>
              <span className="pill ok">
                <span className="dot" />
                live
              </span>
              <div className={s.rowMain}>
                <div className={s.rowName}>
                  {session.name}
                  {session.id === currentId && <span className={s.rowTag}>selected</span>}
                </div>
                <div className={s.rowSub}>
                  {summarize(session)} · started {when(session.createdAt)}
                </div>
              </div>
              <div className={s.rowActions}>
                <button className="btn-outline" type="button" onClick={() => { setCurrentSession(handle, gameId, session.id); onOpen(session.id); }}>
                  Open
                </button>
                <button
                  className="btn-outline"
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(`${origin}/@${handle}/${gameId}?s=${session.id}`);
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
                    setSessions(endSession(handle, gameId, session.id));
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
    const load = () => setSessions(readSessions(handle, gameId).filter((x) => sessionState(x) === "live"));
    load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [handle, gameId]);

  if (sessions.length < 2) return null;
  return (
    <div className="chips" style={{ marginBottom: 4 }}>
      {sessions.map((session) => (
        <button
          key={session.id}
          type="button"
          className={`chip${session.id === currentId ? " active" : ""}`}
          onClick={() => {
            setCurrentSession(handle, gameId, session.id);
            onSwitch(session.id);
          }}
        >
          {session.name}
        </button>
      ))}
    </div>
  );
}
