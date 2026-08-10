"use client";

import type { Profile, TaskGameConfig, RouletteConfig, FundraiserConfig } from "@/lib/data/types";
import { usd, usdPrecise } from "@/lib/money";
import { fundraiserFloor, rouletteFloor, taskFloor } from "@/lib/data/floors";
import styles from "./GameRules.module.css";

// The "Rules" tab every public game page carries.
//
// Viewers are being asked to send real money into escrow on the strength of a headline. The terms
// that decide what happens to that money — the minimum, how long the maker has, what happens if
// they don't deliver — were only ever implied by the form: a placeholder here, a disabled button
// there. Someone who wanted to know before paying had no page to read.
//
// Everything below is generated from the same config the game itself enforces (lib/data/gameConfig),
// so the rules can't drift out of date the way a hand-written blurb would. Where a number is the
// maker's own choice it says so; where it's how Cheer works, it's stated plainly.

interface Line {
  term: string;
  desc: string;
}

function hours(n: number): string {
  if (!n || n <= 0) return "—";
  if (n < 24) return `${n} ${n === 1 ? "hour" : "hours"}`;
  const d = Math.round(n / 24);
  return `${d} ${d === 1 ? "day" : "days"}`;
}

function days(n: number): string {
  if (!n || n <= 0) return "—";
  return `${n} ${n === 1 ? "day" : "days"}`;
}

export function taskLines(cfg: TaskGameConfig, name: string): Line[] {
  return [
    // The effective floor, not the creator's knob: below it the canister refuses
    // the task, and the rules page is where someone reads the terms BEFORE paying.
    { term: "Minimum", desc: `${usdPrecise(taskFloor(cfg.minAmount).amount)} per task. Anything below that isn't accepted.` },
    {
      term: "Your money is held, not sent",
      desc: `It sits in escrow — ${name} can't touch it until the task is done. Nothing is paid out on the promise alone.`,
    },
    cfg.requireApproval
      ? { term: "Approval first", desc: `${name} accepts or declines your task. Declined means an immediate refund — the clock only starts once it's accepted.` }
      : { term: "No approval needed", desc: `Your task goes straight onto the list and the clock starts at once.` },
    { term: "Time to deliver", desc: `${hours(cfg.deadlineHours)} once it's accepted.` },
    { term: "If it isn't done", desc: `You claim your money back after the deadline. The refund is yours to take — nobody has to approve it.` },
    { term: "Queue limit", desc: `Up to ${cfg.maxActiveTasks} tasks run at once; new ones wait until a slot frees up.` },
  ];
}

export function rouletteLines(cfg: RouletteConfig, name: string, noun: string): Line[] {
  const elimination = cfg.format === "elimination";
  const out: Line[] = [
    { term: "How to enter", desc: `Back a ${noun} with a donation. What you give becomes that ${noun}'s share of the wheel.` },
    { term: "Minimum", desc: `${usdPrecise(rouletteFloor(cfg.minDonation).amount)} to put a ${noun} on the wheel.` },
    {
      term: elimination ? "How it's decided" : "The odds",
      desc: elimination
        ? `The wheel spins again and again, knocking one out each time — last one standing wins. The more money behind a ${noun}, the less likely it is to be knocked out.`
        : `One spin decides it. A ${noun} with a bigger share of the pot has a proportionally bigger slice of the wheel.`,
    },
    { term: "Your money isn't returned", desc: `A donation is a donation — backing a ${noun} pays ${name} whether or not it wins.` },
  ];
  if (cfg.minTier) out.push({ term: "Who can suggest", desc: `${cfg.minTier} tier and above.` });
  if (cfg.excludeTopTier) out.push({ term: "Top tier sits out", desc: `${name}'s highest tier doesn't suggest here.` });
  if (cfg.genres?.length) out.push({ term: "Allowed categories", desc: cfg.genres.join(", ") });
  return out;
}

export function fundraiserLines(cfg: FundraiserConfig, name: string): Line[] {
  return [
    { term: "Minimum", desc: `${usdPrecise(fundraiserFloor(cfg.minContribution).amount)} per contribution.` },
    { term: "Your money is held, not sent", desc: `Every contribution sits in escrow until the goal is settled — it isn't ${name}'s to spend before then.` },
    { term: "Open for", desc: days(cfg.fundingDays) },
    {
      term: "If the goal is reached",
      desc: `${name} has ${days(cfg.deliveryDays)} to deliver what was promised.`,
    },
    cfg.allowBelowGoal
      ? {
          term: "If it falls short",
          desc: `${name} may still accept from ${cfg.minAcceptPct}% of the goal and deliver. Below that, everyone is refunded.`,
        }
      : { term: "If it falls short", desc: `Nothing is collected — every contribution is refunded in full.` },
    { term: "If nothing is delivered", desc: `You claim your money back after the delivery window closes.` },
  ];
}


export function GameRules({ lines, mine }: { lines: Line[]; mine?: Profile | null }) {
  return (
    <div className={styles.wrap}>
      <dl className={styles.list}>
        {lines.map((l) => (
          <div className={styles.row} key={l.term}>
            <dt className={styles.term}>{l.term}</dt>
            <dd className={styles.desc}>{l.desc}</dd>
          </div>
        ))}
      </dl>
      {/* The one thing that isn't the maker's choice, said once at the bottom: the money is on a
          public chain either way, so "trust me" is never part of the deal. */}
      <p className={styles.note}>
        Every payment here runs through Cheer&apos;s escrow on Solana{mine?.name ? ` — ${mine.name} sets the terms above, not what happens to the money` : ""}.
        Refunds are yours to claim; nobody has to release them for you.
      </p>
    </div>
  );
}
