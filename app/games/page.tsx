"use client";

import { useState } from "react";
import Link from "next/link";
import { TopNav } from "@/components/TopNav";
import { GameCover } from "@/components/GameCover";
import { SuggestGameModal } from "@/components/SuggestGameModal";
import { GAMES } from "@/lib/data/games";
import gl from "@/components/GamesList.module.css";
import styles from "./page.module.css";

// /games — the platform's mini-games catalog. A plain, full-width poster grid of every game, with a
// single call to action to propose a new one. (The old search + sort/money filters were dropped:
// there are only a handful of games, so filtering them was more chrome than help.)
export default function GamesPage() {
  const [suggestOpen, setSuggestOpen] = useState(false);

  return (
    <main className={styles.wrap}>
      <TopNav active="games" />

      <div className={styles.main}>
        <div className={styles.head}>
          <div className={styles.headText}>
            <h1 className={styles.title}>Mini-games</h1>
            <p className={styles.subtitle}>Games built on top of donations — every one pays straight to the maker.</p>
          </div>
          {/* Suggest a mini-game — opens a modal (same shell as the wallet connect one). */}
          <button type="button" className={styles.suggest} onClick={() => setSuggestOpen(true)}>
            <PlusIcon />
            Suggest a mini-game
          </button>
        </div>

        <div className={styles.grid}>
          {GAMES.map((game) => {
            const inner = (
              <>
                <span className={gl.cover}>
                  <GameCover id={game.id} />
                </span>
                <div className={gl.caption}>
                  <div className={gl.capHead}>
                    <span className={gl.title}>{game.title}</span>
                  </div>
                  <p className={gl.tagline}>{game.tagline}</p>
                </div>
              </>
            );
            // Same rule as the catalog component: only games with their own page are clickable.
            return game.hasPage ? (
              <Link key={game.id} href={`/games/${game.id}`} className={`${gl.card} ${styles.cell}`} aria-label={game.title}>
                {inner}
              </Link>
            ) : (
              <div key={game.id} className={`${gl.card} ${styles.cell}`} tabIndex={0} aria-label={game.title}>
                {inner}
              </div>
            );
          })}
        </div>
      </div>

      {suggestOpen && <SuggestGameModal onClose={() => setSuggestOpen(false)} />}
    </main>
  );
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
