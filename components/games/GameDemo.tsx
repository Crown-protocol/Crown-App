"use client";

import type { ReactNode } from "react";
import type { GameId } from "@/lib/data/games";
import { RouletteDemo } from "@/components/games/demos/RouletteDemo";
import { TaskDemo } from "@/components/games/demos/TaskDemo";
import { FundraiserDemo } from "@/components/games/demos/FundraiserDemo";
import { AuctionDemo } from "@/components/games/demos/AuctionDemo";
import styles from "./GameDemo.module.css";

// The interactive demo beside each game's rules. One shared shell (a card + a 3-step dot indicator);
// the actual mechanic — a spinning wheel, a task queue, a fill-up goal, a bid board — is per game.
export function GameDemo({ id }: { id: GameId }) {
  switch (id) {
    case "roulette":
      return <RouletteDemo />;
    case "task":
      return <TaskDemo />;
    case "fundraiser":
      return <FundraiserDemo />;
    case "auction":
      return <AuctionDemo />;
    default:
      return null;
  }
}

// The card frame every demo shares: header + a 3-dot progress indicator (0 = intro, 1 = setup, 2 = run).
export function DemoFrame({ step, children }: { step: number; children: ReactNode }) {
  return (
    <div className={styles.demo}>
      <div className={styles.head}>
        <span className={styles.headTitle}>Try it yourself</span>
        <span className={styles.dots} aria-hidden>
          {[0, 1, 2].map((i) => (
            <i key={i} className={i <= step ? styles.on : ""} />
          ))}
        </span>
      </div>
      {children}
    </div>
  );
}
