import Link from "next/link";
import { CrownBadge } from "@/components/CrownBadge";
import { TopRight } from "@/components/TopRight";
import styles from "./TopNav.module.css";

const LINKS = [
  { href: "/discover", label: "Find a content maker" },
  { href: "/games", label: "Mini-games" },
];
// Admin/ops is reachable by direct URL only — it must not be advertised in the public marketing
// nav (every anonymous visitor would see and open it). Gating the /admin route itself is backend.

// The one and only top navigation on the site: wordmark + nav links + TopRight.
// Every full-nav page renders this — don't fork a second copy, or pages drift out of sync.
//
// No "Connect wallet" here on purpose. This nav only appears on the marketing surfaces
// (home, /discover, /games), where nobody pays for anything — a connect button there reads as a
// second, competing way to "sign in" next to "Create your page". The wallet is asked for exactly
// where money moves: DonateForm turns its own button into "Connect wallet" in chain mode, and the
// create wizard asks on its wallet step. Don't re-add it to the nav.
export function TopNav({ active, className = "" }: { active?: "games" | "discover"; className?: string }) {
  return (
    <header className={`${styles.topnav} ${className}`}>
      <div className={styles.bar}>
        <div className={styles.left}>
          <Link className={styles.brand} href="/">
            <CrownBadge size={30} />
            CROWN
          </Link>
          <nav className={styles.nav}>
            {LINKS.map((l) => {
              const key = l.href === "/games" ? "games" : l.href === "/discover" ? "discover" : null;
              return (
                <Link key={l.label} className={`${styles.navLink} ${active && key === active ? styles.navActive : ""}`} href={l.href}>
                  {l.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className={styles.right}>
          <TopRight />
        </div>
      </div>
    </header>
  );
}
