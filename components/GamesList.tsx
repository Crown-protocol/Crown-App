import Link from "next/link";
import { GameCover } from "@/components/GameCover";
import { GAMES } from "@/lib/data/games";
import styles from "./GamesList.module.css";

/**
 * Mini-games catalog: poster cards in a grid, each with its own cover art (components/GameCover).
 * Title and description reveal on hover. `limit` — show only the first N (for the homepage
 * teaser); without it — every game in the catalog.
 *
 * No shipping-status badge here: the catalog sells what the games ARE, and a status label
 * on every card just read as noise. A game's own page still states where it stands.
 */
export function GamesList({
  limit,
  alwaysShowCaption,
  columns,
}: {
  limit?: number;
  alwaysShowCaption?: boolean;
  columns?: number;
}) {
  const games = limit ? GAMES.slice(0, limit) : GAMES;
  return (
    <div className={styles.grid} style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 220px))` } : undefined}>
      {games.map((game) => {
        const className = `${styles.card}${alwaysShowCaption ? ` ${styles.alwaysShow}` : ""}`;
        const inner = (
          <>
            <span className={styles.cover}>
              <GameCover id={game.id} />
            </span>
            <div className={styles.caption}>
              <div className={styles.capHead}>
                <span className={styles.title}>
                  {game.title}
                  {/* Named here too: someone browsing the games shouldn't discover it's unfinished
                      only after opening it. */}
                  {game.comingSoon && <span className="game-soon">Soon</span>}
                </span>
              </div>
              <p className={styles.tagline}>{game.tagline}</p>
            </div>
          </>
        );
        // Only games with their own page (games.ts hasPage) are clickable — the rest
        // stay inert placeholders until there's somewhere real to send a click.
        return game.hasPage ? (
          <Link key={game.id} href={`/games/${game.id}`} className={className} aria-label={game.title}>
            {inner}
          </Link>
        ) : (
          <div key={game.id} className={className} tabIndex={0} aria-label={game.title}>
            {inner}
          </div>
        );
      })}
    </div>
  );
}
