"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
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
import { readTasks, withTaskPageDefaults } from "@/lib/data/tasks";
import { withRouletteDefaults } from "@/lib/data/roulette";
import { withAuctionDefaults } from "@/lib/data/auction";
import { withFundraiserDefaults } from "@/lib/data/fundraiser";
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
import { topicNoun } from "@/lib/data/roulette-topics";
import { NumberInput } from "@/components/NumberInput";
import { hoursText, daysText, minutesText } from "@/components/RulesSummary";
import type { AuctionConfig, Profile, RouletteConfig, TaskGameConfig } from "@/lib/data/types";
import type { GameId } from "@/lib/data/games";
import { usd } from "@/lib/money";
import { useConfirm } from "@/components/useConfirm";
import { dangerCopy } from "@/lib/data/dangerous";
import { useCheer } from "@/lib/data/DataProvider";
import { GAMES } from "@/lib/data/games";
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
  onSave,
  gameId,
  gameTitle,
  onOpen,
  onCreated,
  onSessionsChanged,
  autoOpenStarter = false,
}: {
  profile: Profile;
  onSave: (p: Profile) => void; // clearing last run's pitch is a profile write
  gameId: GameId;
  gameTitle: string;
  onOpen: (sessionId: string) => void; // opening an existing session → its control room
  // Open the starter dialog as soon as this mounts. Used when a game has no sessions at all: the
  // sidebar sends you straight here to start one, so a page whose only content is a button you
  // then have to press is a step that says nothing.
  autoOpenStarter?: boolean;
  onCreated?: (sessionId: string) => void; // a fresh session → the Page tab, to set it up and share
  // Ending a run changes what the sidebar should show — with none left, its sub-tabs go away. The
  // parent counts sessions itself, so it needs to be told to look again.
  onSessionsChanged?: () => void;
}) {
  const handle = profile.handle;
  const tiers = profile.tiers ?? [];
  const confirm = useConfirm(); // ending a session kills its public page — no way back
  const [chainErr, setChainErr] = useState("");
  // The chain gate for the two canister-backed creates (roulette has no canister by design).
  const chain = useGameChain(gameId === "fundraiser" ? "fundraiser" : gameId === "auction" ? "auction" : "task");
  const { mode } = useCheer();
  // A game still being built: playable end to end in mock mode so it can be demoed and worked on,
  // but never started against the chain, where a run would take real money it can't yet settle.
  const comingSoon = !!GAMES.find((g) => g.id === gameId)?.comingSoon;
  const [sessions, setSessions] = useState<GameSession[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [origin, setOrigin] = useState("");

  // The rules this run will open with — one state per game, seeded from the maker's standing
  // defaults (scope `null` = "stop at the profile", gameConfig.ts).
  const [task, setTask] = useState<TaskGameConfig>(() => taskRules(profile, null));
  const [roul, setRoul] = useState<RouletteConfig>(() => rouletteRules(profile, null));
  // Whether the (long) rules form is showing while other sessions are already live.
  const [starterExpanded, setStarterExpanded] = useState(autoOpenStarter);
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

  // Has anything actually been changed away from the maker's own defaults? Only then is there
  // something to reset — a "Reset to my defaults" button next to untouched defaults is a control
  // that does nothing, and the reader has to work that out by pressing it.
  //
  // Compared per game, because that's what this form is showing: fiddling with roulette settings
  // shouldn't light up the reset button on the auction tab. JSON compare is enough — these are
  // small flat config objects built by the same function on both sides, so key order matches.
  const dirty = (() => {
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    switch (gameId) {
      case "task":
        return !same(task, taskRules(profile, null));
      case "roulette":
        return !same(roul, rouletteRules(profile, null)) || rankMode;
      case "fundraiser":
        return !same(fund, fundraiserRules(profile, null));
      case "auction":
        return !same(auc, auctionRules(profile, null));
      default:
        return false;
    }
  })();

  // Switching games in the cabinet re-seeds the form. Deliberately NOT keyed on `profile`: it's
  // saved on every keystroke elsewhere in the cabinet, and re-seeding then would yank the knobs
  // out from under whoever is setting them here.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(resetRules, [gameId]);

  // Escape closes the starter and the page behind it stops scrolling — the same behaviour every
  // other dialog here has, so the one that asks for money rules doesn't feel different.
  useEffect(() => {
    // Only while it's a dialog: inline there is nothing underneath, so Escape would blank the page.
    if (!starterExpanded || sessions.filter((x) => sessionState(x) === "live").length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setStarterExpanded(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [starterExpanded, handle, gameId, sessions]);

  // Ending the last live run empties the screen: the list disappears and all that's left is the
  // "+ Start a new session" button. `autoOpenStarter` only seeds the initial state — this component
  // is already mounted by then — so nothing reopened the form and the tab went blank-ish instead of
  // going back to "start one". Watch the live count rather than the prop.
  const liveCount = sessions.filter((x) => sessionState(x) === "live").length;
  useEffect(() => {
    if (liveCount === 0) setStarterExpanded(true);
  }, [liveCount]);

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

  const noun = topicNoun(roul.topic);
  const bidFloor = Math.max(PLATFORM_MIN_BID, Math.round(auc.minBid) || PLATFORM_MIN_BID);

  // Missing pieces, in the order a maker reads the form. Empty = ready to start.
  const missing: string[] = [];

  // Named, not optional: sessions are picked from a list (and from the builder's session select),
  // where an auto-name like "Tasks #3" tells you nothing about which run it is. Listed first
  // because it's the first field in the form.
  const nameMissing = !name.trim();
  if (nameMissing) missing.push("name this session");

  if (gameId === "roulette") {
    if (!roul.topic?.trim()) missing.push("say what viewers suggest");
    if (!(roul.minDonation > 0)) missing.push("set the minimum to suggest");
    if (!(roul.roundMinutes > 0)) missing.push("set how long the round runs");
  }
  if (gameId === "task") {
    if (!(task.minAmount > 0)) missing.push("set the minimum task amount");
    if (!(task.deadlineHours > 0)) missing.push("set the longest deadline");
  }
  if (gameId === "fundraiser") {
    if (!(fund.goal > 0)) missing.push("set the goal");
    if (!(fund.minContribution > 0)) missing.push("set the minimum chip-in");
    if (!(fund.fundingDays > 0)) missing.push("set how long the collection runs");
  }
  if (gameId === "auction") {
    if (!(auc.minBid > 0)) missing.push("set the minimum bid");
    if (!(auc.biddingHours > 0)) missing.push("set the bidding window");
    if (!(auc.performHours > 0)) missing.push("set the time to deliver");
  }
  if (comingSoon && mode === "chain") {
    missing.push(`${GAMES.find((g) => g.id === gameId)?.title ?? "this game"} isn't live yet — switch to mock to try it`);
  }
  const ready = missing.length === 0;

  async function start() {
    // The button is disabled, but Enter in the name field reaches here too.
    if (!ready) return;
    setChainErr("");

    // Canister-live games are born ON the canister first — a session without its chain id
    // would take real escrows it can never resolve. Mock stays untouched when gates are off.
    // The numbers handed over are THIS session's, not the profile's: the canister is where they
    // become binding, so the two must be the same numbers.
    let chainCollection: string | undefined;
    let chainAuction: string | undefined;
    if (chain.live && (gameId === "fundraiser" || gameId === "auction")) {
      if (!chain.wallet) {
        // Says what to do, not what's under the hood — "the canister" means nothing to the person
        // holding the wallet, and the reason they're being asked is that real money is involved.
        setChainErr("Connect your wallet — this game runs on real escrow.");
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

    // Last run's pitch/description belong to last run. Wiping them here (rather than on delete)
    // means an abandoned session leaves nothing behind either.
    const blankTexts = { headline: "", description: "" };
    if (gameId === "task") onSave({ ...profile, taskPage: { ...withTaskPageDefaults(profile), ...blankTexts } });
    if (gameId === "roulette") onSave({ ...profile, roulette: { ...withRouletteDefaults(profile), ...blankTexts } });
    if (gameId === "auction") onSave({ ...profile, auction: { ...withAuctionDefaults(profile), ...blankTexts } });
    // Fundraiser calls its headline "pledge".
    if (gameId === "fundraiser") onSave({ ...profile, fundraiser: { ...withFundraiserDefaults(profile), pledge: "", description: "" } });

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
    setStarterExpanded(false);
    refresh();
    (onCreated ?? onOpen)(session.id);
  }

  const live = sessions.filter((x) => sessionState(x) === "live");
  const starterOpen = starterExpanded;
  // With nothing running, the form IS the screen — not a dialog floating over a page whose only
  // content is the button that opened it. Dimming an empty page to draw attention to the one thing
  // on it says nothing. With sessions already listed there is something to come back to, so the
  // form stays a dialog and the list keeps its place underneath.
  // Keyed on LIVE runs, not on every session ever created. A finished run isn't something to come
  // back to — the list below only shows live ones — so a game whose only session ended still has an
  // empty screen, and dimming it to float a dialog over nothing is the thing this replaced.
  const starterInline = starterOpen && live.length === 0;

  const starterForm = (
        <div className={`card ${s.starter}${starterInline ? "" : ` ${s.modalCard}`}`} onClick={(e) => e.stopPropagation()}>
        <div className={s.head}>
          <div className={s.headRow}>
            <h2>Start a {gameTitle} session</h2>
            {/* Cancel closes the dialog — but inline there is nothing behind it to go back to, so
                pressing it would leave a blank screen with no way forward. Shown only when the form
                is floating over a list. */}
            {!starterInline && (
              <button type="button" className={s.starterClose} onClick={() => setStarterExpanded(false)} aria-label="Close">
                Cancel
              </button>
            )}
          </div>
          {/* The heading already names the game; repeating it in the next line was the third
              time the word appeared on screen. */}
          <p>Its own board, its own link, and the rules you set here.</p>
        </div>

        <div className="field">
          <label htmlFor="sess-name">
            Name
            {/* Flagged only while it's empty — once written the badge has done its job. */}
            {nameMissing && <span className={s.required}>Required</span>}
          </label>
          <input
            id="sess-name"
            type="text"
            placeholder={`e.g. “Friday ${gameTitle.toLowerCase()}”`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void start()}
            aria-required
            autoFocus
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
                  <label htmlFor="sess-roul-topic">What viewers suggest</label>
                  <input
                    id="sess-roul-topic"
                    type="text"
                    placeholder="game"
                    value={roul.topic ?? ""}
                    onChange={(e) => setRoul({ ...roul, topic: e.target.value })}
                  />
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
                ? `${roul.minTier || tiers[0]?.name || "Ranked"}+ viewers put a ${noun} on the wheel for free`
                : `${roul.minTier ? `${roul.minTier}+ viewers` : "Anyone"} can back a ${noun} from ${usd(roul.minDonation)}`}
              {roul.excludeTopTier ? " (except your top tier)" : ""}. Suggestions stay open {minutesText(roul.roundMinutes)}, then{" "}
              {roul.format === "elimination" ? "the wheel spins until one is left" : "one spin picks the winner"} — the more money behind a{" "}
              {noun}, the better its odds. You play it for {minutesText(roul.playMinutes)}. Money on the {noun}s that don&apos;t win
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
          <button className="btn" type="button" disabled={!ready} onClick={() => void start()}>
            Start session
          </button>
          {dirty && (
            <button className={s.reset} type="button" onClick={resetRules}>
              Reset to my defaults
            </button>
          )}
          {/* Say what's missing rather than leaving a dead button with no explanation. */}
          {!ready && <div className={s.needs}>Before you start: {missing.join(" · ")}.</div>}
          {chainErr && <div className={s.err}>{chainErr}</div>}
        </div>
        </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* The "+ Start a new session" button is for adding another run alongside the ones listed
          below. With none listed there is nothing to add to — the form itself is the screen. */}
      {!starterInline && (
        <button type="button" className={`card ${s.starterCollapsed}`} onClick={() => setStarterExpanded(true)}>
          <span className={s.starterPlus} aria-hidden>+</span>
          Start a new session
        </button>
      )}

      {starterInline && starterForm}

      {starterOpen &&
        !starterInline &&
        createPortal(
          <div
            className={s.modalBack}
            role="dialog"
            aria-modal="true"
            aria-label={`Start a ${gameTitle} session`}
            onClick={() => setStarterExpanded(false)}
          >
            {starterForm}
          </div>,
          document.body
        )}

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
                <div className={s.rowName}>{session.name}</div>
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
                  onClick={() =>
                    confirm(dangerCopy.endSession(session.name), () => {
                      setSessions(endSession(handle, gameId, session.id));
                      refresh();
                      onSessionsChanged?.();
                    })
                  }
                >
                  End
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {confirm.dialog}
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
