"use client";

import { useEffect, useRef, useState } from "react";
import { setCtaHandoff } from "@/lib/data/ctaHandoff";
import { useSignedIn } from "@/lib/data/useSignedIn";
import Link from "next/link";
import { TopNav } from "@/components/TopNav";
import { GamesList } from "@/components/GamesList";
import { ObsWidgets } from "@/components/ObsWidgets";
import { HeroPhones } from "@/components/HeroPhones";
import { MoneyFlow } from "@/components/MoneyFlow";
import { SiteFooter } from "@/components/SiteFooter";
import { RepDemo } from "@/components/RepDemo";
import { AuthButton } from "@/components/AuthButton";
import { useProfile } from "@/lib/data/ProfileProvider";
import styles from "./page.module.css";

export default function HomePage() {
  const rootRef = useRef<HTMLElement>(null);
  const { ready } = useProfile();
  // Same source of truth as the header — see components/TopRight.tsx.
  const signedIn = useSignedIn();
  // Mirrors what we publish to the header, so both halves of the swap move together.
  const [handedOff, setHandedOff] = useState(false);

  // Scroll reveal, downward only: a section animates when you scroll DOWN into it, and again if you
  // go back up and come down a second time — but scrolling UP never animates. A block sliding in as
  // it re-enters from above reads as the page fighting the scroll.
  //
  // Direction is tracked from scrollY rather than read off the observer entry: with a tall section
  // and this rootMargin, scrolling past one never drops it under the threshold, so the observer
  // simply doesn't fire on the way back up — there's no "entering from above" event to react to.
  // So: only reveal while scrolling down, and re-arm (back to the hidden start state) once a
  // section sits fully below the viewport again, which can only happen after you've scrolled up
  // past it. Scrolling up therefore neither animates nor un-reveals what's already on screen.
  useEffect(() => {
    const els = rootRef.current?.querySelectorAll(`.${styles.reveal}`);
    if (!els || els.length === 0) return;

    if (typeof IntersectionObserver === "undefined") {
      els.forEach((el) => el.classList.add(styles.inView));
      return;
    }

    let lastY = window.scrollY;
    let goingDown = true;

    const onScroll = () => {
      const y = window.scrollY;
      if (y !== lastY) goingDown = y > lastY;
      lastY = y;

      for (const el of els) {
        const r = el.getBoundingClientRect();
        // Re-arm: fully below the viewport again (only reachable by scrolling up past it).
        if (r.top >= window.innerHeight) {
          el.classList.remove(styles.inView);
          continue;
        }
        // Reveal only on the way down, once the section is meaningfully on screen.
        if (goingDown && r.top < window.innerHeight * 0.9) el.classList.add(styles.inView);
      }
    };

    onScroll(); // reveal whatever is already on screen at mount (the hero)
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // The header's sign-up button and this page's closing one are the same offer. Hand the baton to
  // the big one as it comes into view (and back on the way up) so only one is ever on screen.
  const finalRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = finalRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => {
        setCtaHandoff(entry.isIntersecting);
        setHandedOff(entry.isIntersecting);
      },
      // Only once it's genuinely in play, not the moment a pixel appears.
      { threshold: 0.6 }
    );
    io.observe(el);
    return () => {
      io.disconnect();
      setCtaHandoff(false);
      setHandedOff(false);
    };
  }, []);

  return (
    <main className={styles.wrap} ref={rootRef}>
      <TopNav className={styles.navIn} />

      <section className={`${styles.band} ${styles.heroBand}`}>
        <div className={styles.bandInner}>
          <div className={styles.heroCenter}>
            <h1 className={`${styles.heroTitle} ${styles.reveal} ${styles.d1}`}>
              Donations you can <span className={styles.italic}>play</span>
            </h1>
            <p className={`${styles.heroSub} ${styles.reveal} ${styles.d2}`}>
              A donation page in dollars, plus mini-games your viewers run — straight to your wallet.
            </p>
            {/* No buttons in the hero. The nav already carries "Create or log in" for a signed-out
                visitor, and the closing band carries it again after the pitch — a third copy on top
                of the fold just repeated itself. */}
          </div>
          <div className={`${styles.reveal} ${styles.d4}`}>
            <HeroPhones />
          </div>
        </div>
      </section>

      <section className={`${styles.band} ${styles.flowBand}`}>
        <div className={styles.bandInner}>
          <div className={styles.reveal}>
            <MoneyFlow />
          </div>
        </div>
      </section>

      <section className={`${styles.band} ${styles.bandAlt}`}>
        <div className={styles.bandInner}>
          <div className={styles.reveal}>
            <div className={styles.gamesHead}>
              <div>
                <h2>Mini-games</h2>
                <p>Games built on top of your donations.</p>
              </div>
              <Link className={styles.seeAll} href="/games">
                See all mini-games →
              </Link>
            </div>
            {/* No limit and no fixed column count: the teaser shows every game there is and the
                grid lays itself out. Both were hardcoded to 3, so the fourth game silently
                vanished from the homepage the moment it shipped. */}
            <GamesList alwaysShowCaption />
          </div>
        </div>
      </section>

      <section className={styles.band}>
        <div className={styles.bandInner}>
          <div className={`${styles.repSection} ${styles.reveal}`}>
            <div className={styles.repCopy}>
              <h2 className={styles.repTitle}>
                Every donation earns a <span className={styles.italic}>rank</span>
              </h2>
              <p className={styles.repLead}>
                Each dollar builds a viewer&apos;s reputation <b>with you</b> — and climbs the tiers you set.
                Try it.
              </p>
            </div>

            <div className={styles.repViz}>
              <RepDemo />
            </div>
          </div>
        </div>
      </section>

      <section className={`${styles.band} ${styles.bandAlt}`}>
        <div className={styles.bandInner}>
          <div className={styles.reveal}>
            <ObsWidgets />
          </div>
        </div>
      </section>

      <section className={`${styles.band} ${styles.finalBand}`}>
        <div className={styles.bandInner}>
          {/* Don't pitch "create a page" at someone who already has one — send them to it.
              Rendered only once the profile is read, so the button never flips under the cursor. */}
          <div className={`final ${styles.reveal}`} ref={finalRef}>
            {/* `cta-arrive` is the mirror of the header's `cta-handoff`: same duration and easing,
                so exactly one of the two is ever solid — they cross over instead of overlapping. */}
            {!ready ? null : signedIn ? (
              <>
                <p>Your page is live.</p>
                <span className={`cta-arrive${handedOff ? " here" : ""}`}>
                  <Link className="btn" href="/space">
                    Personal space
                  </Link>
                </span>
              </>
            ) : (
              <>
                <p>All you need is a wallet.</p>
                <span className={`cta-arrive${handedOff ? " here" : ""}`}>
                  <AuthButton label="Create or log in" />
                </span>
              </>
            )}
          </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
