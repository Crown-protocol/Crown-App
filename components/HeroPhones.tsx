import Link from "next/link";
import { HeroFundraiserFill } from "./HeroFundraiserFill";
import { RouletteWheel } from "./RouletteWheel";
import type { RouletteSuggestion } from "@/lib/data/roulette-mock";
import styles from "./HeroPhones.module.css";

// The center phone shows the REAL wheel component (same SVG the roulette page renders), not a
// CSS-circle lookalike — leader slice on the accent gradient, proportional slices = odds.
// Pools are the vote weights: they drive both the wheel slices and the round-card percentages,
// so the two always agree. 720/540/360/180 of a 1800 pot → a clean 40/30/20/10 split.
const HERO_ROUND: RouletteSuggestion[] = [
  { id: "s1", title: "Elden Ring", genre: "RPG", pool: 720, backers: 7, suggestedBy: "Timur" },
  { id: "s2", title: "Fortnite", genre: "Shooter", pool: 540, backers: 5, suggestedBy: "anna_k" },
  { id: "s3", title: "Minecraft", genre: "Simulation", pool: 360, backers: 3, suggestedBy: "Dan" },
  { id: "s4", title: "Dota 2", genre: "Strategy", pool: 180, backers: 2, suggestedBy: "leo" },
];

// Three fanned phone mockups for the hero — one per mini-game, mirroring the REAL public pages
// (same headline/wheel/pot-card, same crown-fill fundraiser) so the hero shows the actual
// product, not a lookalike. Each phone links to that game's own page in the catalog (/games/<id>,
// games.ts hasPage) — what the game IS — rather than to one seeded streamer's live page, which
// is a demo, not an explanation.

// 13:37 — "leet". The stock mockup time is Apple's 9:41 (the hour the first iPhone was unveiled);
// borrowing their easter egg in our own hero was a wasted slot, so the phones tell gamer time
// instead. Reads as a plain clock to anyone who doesn't know, which is the point of an easter egg.
const CLOCK = "13:37";

function StatusBar({ dark = false }: { dark?: boolean }) {
  return (
    <div className={`${styles.status}${dark ? " " + styles.statusDark : ""}`}>
      <span className={styles.time}>{CLOCK}</span>
      <span className={styles.statusIcons}>
        <span className={styles.bars} />
        <span className={styles.battery} />
      </span>
    </div>
  );
}

export function HeroPhones() {
  return (
    <div className={styles.phones}>
      {/* LEFT — Task for donation (mirrors the task widget on the streamer page) */}
      <Link href="/games/task" aria-label="See the Task for donation game" className={`${styles.phone} ${styles.side} ${styles.left}`}>
        <span className={styles.notch} />
        <div className={styles.screen}>
          <StatusBar />
          <div className={`${styles.game} ${styles.gameLeft}`}>
            <div className={styles.eyebrow}>Task for donation</div>
            <div className={styles.taskCard}>
              <div className={styles.taskQuote}>“Beat the boss with no armor.”</div>
              <div className={styles.taskAmt}>$50</div>
              <div className={styles.escrow}>
                <span className={styles.escrowDot} />
                Held in escrow
              </div>
            </div>
            <div className={styles.cta}>Set the task</div>
          </div>
        </div>
      </Link>

      {/* CENTER — Roulette (mirrors the roulette page: headline, wheel, pot card) */}
      <Link href="/games/roulette" aria-label="See the Roulette game" className={`${styles.phone} ${styles.center}`}>
        <span className={styles.notch} />
        <div className={styles.screen}>
          <StatusBar />
          <div className={styles.game}>
            <div className={styles.eyebrow}>
              Roulette · <em className={styles.open}>round open</em>
            </div>
            <h3 className={styles.headline}>You pick what I play next</h3>
            <div className={styles.wheelWrap}>
              <RouletteWheel round={HERO_ROUND} size={168} compact />
            </div>
            <div className={styles.roundCard}>
              <div className={styles.roundHead}>
                <span>This round · 29:11 left</span>
                <span className={styles.pot}>$1,800 in the pot</span>
              </div>
              <div className={styles.rouRow}>
                <span className={styles.rouName}>Elden Ring</span>
                <span className={styles.rouBar}>
                  <span style={{ width: "40%" }} />
                </span>
                <span className={styles.rouPct}>40%</span>
              </div>
              <div className={styles.rouRow}>
                <span className={styles.rouName}>Fortnite</span>
                <span className={styles.rouBar}>
                  <span style={{ width: "30%" }} />
                </span>
                <span className={styles.rouPct}>30%</span>
              </div>
              <div className={styles.rouRow}>
                <span className={styles.rouName}>Minecraft</span>
                <span className={styles.rouBar}>
                  <span style={{ width: "20%" }} />
                </span>
                <span className={styles.rouPct}>20%</span>
              </div>
              <div className={styles.rouRow}>
                <span className={styles.rouName}>Dota 2</span>
                <span className={styles.rouBar}>
                  <span style={{ width: "10%" }} />
                </span>
                <span className={styles.rouPct}>10%</span>
              </div>
            </div>
          </div>
        </div>
      </Link>

      {/* RIGHT — Fundraiser, dark (mirrors the real page: crown fills bottom-up by pct) */}
      <Link href="/games/fundraiser" aria-label="See the Fundraiser game" className={`${styles.phone} ${styles.side} ${styles.right}`}>
        <span className={styles.notch} />
        <div className={`${styles.screen} ${styles.screenDark}`}>
          <StatusBar dark />
          <div className={`${styles.game} ${styles.frGame}`}>
            <div className={styles.eyebrow}>Fundraiser</div>
            <div className={styles.frPledge}>New mic for the stream</div>
            <HeroFundraiserFill pct={0.72} size={154} />
            <div className={styles.frPct}>72%</div>
            <div className={styles.frSums}>
              <b>$1,440</b> of $2,000
            </div>
            <div className={styles.cta}>Chip in</div>
          </div>
        </div>
      </Link>
    </div>
  );
}
