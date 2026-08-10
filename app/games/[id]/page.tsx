import { notFound } from "next/navigation";
import Link from "next/link";
import { TopNav } from "@/components/TopNav";
import { GameIcon } from "@/components/icons";
import { getGame } from "@/lib/data/games";
import styles from "./page.module.css";

// One template for every mini-game: hero → how it works (3 plain steps) → what you set (the real
// knobs + their defaults) → CTA, with the game's own interactive demo in a sticky rail alongside.
// Everything a game contributes is data in games.ts (steps/knobs).
export default function GameDetailPage({ params }: { params: { id: string } }) {
  const game = getGame(params.id);

  // A made-up id (/games/nope) is a genuine 404 — real status, not a 200 stand-in page.
  if (!game) notFound();

  // A real game that simply has no detail page yet keeps its friendly "still being built" screen.
  if (!game.hasPage) {
    return (
      <main className={styles.wrap}>
        <TopNav active="games" />
        <div className="center-note">
          <h1>No page for this game yet</h1>
          <p>This one&apos;s still being built — check back later.</p>
          <Link className="btn" href="/games">
            All mini-games
          </Link>
        </div>
      </main>
    );
  }

  const live = game.status === "available";

  return (
    <main className={styles.wrap}>
      <TopNav active="games" />

      <div className={styles.main}>
        <div className={styles.hero}>
          <span className={styles.icon} aria-hidden>
            <GameIcon id={game.id} width={30} height={30} />
          </span>
          <h1>{game.title}</h1>
        </div>
        <p className={styles.tagline}>{game.tagline}</p>

        <div className={styles.cols}>
          <div>
            {game.steps && game.steps.length > 0 && (
              <section className={styles.section}>
                <p className={styles.eyebrow}>How it works</p>
                <div className={styles.steps}>
                  {game.steps.map((s, i) => (
                    <div className={styles.step} key={i}>
                      <span className={styles.stepNum}>{i + 1}</span>
                      <div>
                        <div className={styles.stepLead}>{s.lead}</div>
                        <div className={styles.stepSub}>{s.sub}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {game.knobs && game.knobs.length > 0 && (
              <section className={styles.section}>
                <p className={styles.eyebrow}>What you set</p>
                <div className={styles.knobs}>
                  {game.knobs.map((k) => (
                    <div className={styles.knob} key={k.label}>
                      <div className={styles.knobMain}>
                        <div className={styles.knobLabel}>{k.label}</div>
                        <div className={styles.knobHint}>{k.hint}</div>
                      </div>
                      <span className={styles.knobVal}>{k.value}</span>
                    </div>
                  ))}
                </div>
                <p className={styles.knobsNote}>Default values — every one is yours to change in your space.</p>
              </section>
            )}

            <div className={styles.cta}>
              <Link className="btn" href="/space">
                Set it up on my page
              </Link>
              <span className="footnote">
                {live ? "Enable it from your space." : "Not live yet — you'll be able to enable it here once it ships."}
              </span>
            </div>
          </div>

        </div>
      </div>
    </main>
  );
}
