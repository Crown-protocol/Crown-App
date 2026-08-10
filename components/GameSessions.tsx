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
import { readRound, readRoundMeta, initRound } from "@/lib/data/roulette";
import { readStatus, raisedTotal, writeStatus } from "@/lib/data/fundraiser";
import { readTasks, withTaskPageDefaults } from "@/lib/data/tasks";
import { withRouletteDefaults } from "@/lib/data/roulette";
import { withFundraiserDefaults } from "@/lib/data/fundraiser";
import { useGameChain } from "@/lib/chain/useGameChain";
import { fundingCreateCollection } from "@/lib/chain/gameFlows";
import {
  fundraiserRules,
  rouletteRules,
  taskRules,
  writeSessionRules,
  type FundraiserSessionRules,
} from "@/lib/data/gameConfig";
import { DEADLINE_OPTIONS } from "@/components/TaskGameSettings";
import { FUNDING_OPTIONS, DELIVERY_OPTIONS } from "@/components/FundraiserGameSettings";
import { ROUND_OPTIONS, PLAY_OPTIONS } from "@/components/RouletteGameSettings";
import { topicNoun } from "@/lib/data/roulette-topics";
import { NumberInput } from "@/components/NumberInput";
import { hoursText, daysText, minutesText } from "@/components/RulesSummary";
import type { Profile, RouletteConfig, TaskGameConfig } from "@/lib/data/types";
import type { GameId } from "@/lib/data/games";
import { usd } from "@/lib/money";
import { PLATFORM_FLOOR, knobFloorNote } from "@/lib/data/floors";
import { FloorBump, useFloorClamp } from "@/components/games/MinNote";
import { useConfirm } from "@/components/useConfirm";
import { dangerCopy } from "@/lib/data/dangerous";
import s from "./GameSessions.module.css";

// One line that tells the streamer what's inside a session without opening it.
function summarize(session: GameSession): string {
  switch (session.gameId) {
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
// session can open at $50 while the weekday one stays at $5, and editing the defaults later can
// never move the goalposts under money already in escrow. See lib/data/gameConfig.ts.
export function GameSessions({
  profile,
  onSave,
  gameId,
  gameTitle,
  onOpen,
  onCreated,
}: {
  profile: Profile;
  onSave: (p: Profile) => void; // clearing last run's pitch is a profile write
  gameId: GameId;
  gameTitle: string;
  onOpen: (sessionId: string) => void; // opening an existing session → its control room
  onCreated?: (sessionId: string) => void; // a fresh session → the Page tab, to set it up and share
}) {
  const handle = profile.handle;
  const tiers = profile.tiers ?? [];
  const confirm = useConfirm(); // ending a session kills its public page — no way back
  const [chainErr, setChainErr] = useState("");
  // Each knob clamps to the network's floor and says so only when it had to.
  const { clamp: clampTaskMin, bumpNote: taskMinBump } = useFloorClamp(PLATFORM_FLOOR.task, knobFloorNote(PLATFORM_FLOOR.task, "task"));
  const { clamp: clampRoulMin, bumpNote: roulMinBump } = useFloorClamp(
    PLATFORM_FLOOR.donationWithWords,
    knobFloorNote(PLATFORM_FLOOR.donationWithWords, "suggestion")
  );
  const { clamp: clampFundMin, bumpNote: fundMinBump } = useFloorClamp(
    PLATFORM_FLOOR.fundraiser,
    knobFloorNote(PLATFORM_FLOOR.fundraiser, "contribution")
  );
  // The chain gate for the two canister-backed creates (roulette has no canister by design).
  const chain = useGameChain(gameId === "fundraiser" ? "fundraiser" : "task");
  const [sessions, setSessions] = useState<GameSession[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [origin, setOrigin] = useState("");

  // The rules this run will open with — one state per game, seeded from the maker's standing
  // defaults (scope `null` = "stop at the profile", gameConfig.ts).
  const [task, setTask] = useState<TaskGameConfig>(() => taskRules(profile, null));
  const [roul, setRoul] = useState<RouletteConfig>(() => rouletteRules(profile, null));
  // Whether the (long) rules form is showing while other sessions are already live.
  const [starterExpanded, setStarterExpanded] = useState(false);
  const [fund, setFund] = useState<FundraiserSessionRules>(() => fundraiserRules(profile, null));
  // roulette only: who suggests — everyone by donating (classic), or rank X+ for free.
  const [rankMode, setRankMode] = useState(false);

  const resetRules = useCallback(() => {
    setTask(taskRules(profile, null));
    setRoul(rouletteRules(profile, null));
    setFund(fundraiserRules(profile, null));
    setRankMode(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  // Has anything actually been changed away from the maker's own defaults? Only then is there
  // something to reset — a "Reset to my defaults" button next to untouched defaults is a control
  // that does nothing, and the reader has to work that out by pressing it.
  //
  // Compared per game, because that's what this form is showing: fiddling with roulette settings
  // shouldn't light up the reset button on another tab. JSON compare is enough — these are
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
    if (!starterExpanded) return;
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
  }, [starterExpanded]);

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

  // Missing pieces, in the order a maker reads the form. Empty = ready to start.
  const missing: string[] = [];

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
    if (chain.live && gameId === "fundraiser") {
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
    }

    const session = createSession(handle, gameId, name);

    // Last run's pitch/description belong to last run. Wiping them here (rather than on delete)
    // means an abandoned session leaves nothing behind either.
    const blankTexts = { headline: "", description: "" };
    if (gameId === "task") onSave({ ...profile, taskPage: { ...withTaskPageDefaults(profile), ...blankTexts } });
    if (gameId === "roulette") onSave({ ...profile, roulette: { ...withRouletteDefaults(profile), ...blankTexts } });
    // Fundraiser calls its headline "pledge".
    if (gameId === "fundraiser") onSave({ ...profile, fundraiser: { ...withFundraiserDefaults(profile), pledge: "", description: "" } });

    // Pin the rules to this run before anything can be played under them.
    if (gameId === "task") writeSessionRules(session.scope, "task", task);
    if (gameId === "fundraiser") writeSessionRules(session.scope, "fundraiser", fund);
    if (gameId === "roulette") writeSessionRules(session.scope, "roulette", roul);

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
  // The starter is a dialog now, not a panel that unfolds in place. Inline, it pushed the running
  // sessions — the thing you came to this tab for — below a screenful of settings you only touch
  // when starting something new. The button stays put; the form opens over the page.
  const starterOpen = starterExpanded;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <button type="button" className={`card ${s.starterCollapsed}`} onClick={() => setStarterExpanded(true)}>
        <span className={s.starterPlus} aria-hidden>+</span>
        Start a new session
      </button>

      {starterOpen && createPortal(
        <div className={s.modalBack} role="dialog" aria-modal="true" aria-label="Start a session" onClick={() => setStarterExpanded(false)}>
        <div className={`card ${s.starter} ${s.modalCard}`} onClick={(e) => e.stopPropagation()}>
        <div className={s.head}>
          <div className={s.headRow}>
            <h2>Start a session</h2>
            {/* Always available now: as a dialog this is the only visible way out besides Escape,
                and it used to be hidden whenever nothing was running yet. */}
            <button type="button" className={s.starterClose} onClick={() => setStarterExpanded(false)} aria-label="Close">
              Cancel
            </button>
          </div>
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
                    {/* Clamped, not merely hinted: a creator promising "$1 tasks" would be
                        promising something the canister refuses once the money is already
                        in escrow, and the person who pays for that is the viewer. */}
                    <NumberInput
                      id="sess-task-min"
                      min={PLATFORM_FLOOR.task}
                      value={task.minAmount}
                      onCommit={(n) => setTask({ ...task, minAmount: clampTaskMin(n) })}
                    />
                  </div>
                  <FloorBump note={taskMinBump} />
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
                    <NumberInput
                      id="sess-roul-min"
                      min={PLATFORM_FLOOR.donationWithWords}
                      value={roul.minDonation}
                      onCommit={(n) => setRoul({ ...roul, minDonation: clampRoulMin(n) })}
                    />
                  </div>
                  <FloorBump note={roulMinBump} />
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
                    <NumberInput
                      id="sess-fr-min"
                      min={PLATFORM_FLOOR.fundraiser}
                      value={fund.minContribution}
                      onCommit={(n) => setFund({ ...fund, minContribution: clampFundMin(n) })}
                    />
                  </div>
                  <FloorBump note={fundMinBump} />
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
        </div>,
        document.body
      )}

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
