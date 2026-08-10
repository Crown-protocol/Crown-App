"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { TopNav } from "@/components/TopNav";
import { Mono } from "@/components/Mono";
import { Spark } from "@/components/Spark";
import { SearchIcon, SocialIcon, SOCIAL_KINDS, SOCIAL_LABEL } from "@/components/icons";
import { MOCK_STREAMERS, MOCK_REALMS } from "@/lib/data/mock";
import { useCheer } from "@/lib/data/DataProvider";
import { USDC_DECIMALS } from "@/lib/chain/config";
import type { Profile, Social } from "@/lib/data/types";
import styles from "./page.module.css";

type Sort = "all" | "7d";
// How long the exit cascade needs to finish before we swap results and re-enter (must clear the
// longest exit delay + its duration in page.module.css: ~0.34s delay + 0.34s = ~0.68s).
const EXIT_MS = 700;

function money(n: number) {
  return `$${n.toLocaleString("en-US")}`;
}

export default function DiscoverPage() {
  // Demo streamers are opt-in (admin panel). Off by default: the catalog lists only real registered
  // makers, so a visitor never sees invented people with invented totals. On → the MOCK seeds are
  // mixed back in for screenshots/demos.
  const { demoData } = useCheer();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("all");
  const [platforms, setPlatforms] = useState<Social["kind"][]>([]);
  // "entering" (cascade in) / "exiting" (cascade out in reverse). A filter click plays "exiting",
  // then — after the cascade — applies the change and flips back to "entering" so the new,
  // re-sorted results animate in fresh.
  const [anim, setAnim] = useState<"entering" | "exiting">("entering");
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (exitTimer.current) clearTimeout(exitTimer.current);
    },
    []
  );

  // Run a discrete filter change through the exit → swap → enter sequence.
  function queueChange(apply: () => void) {
    if (exitTimer.current) clearTimeout(exitTimer.current);
    setAnim("exiting");
    exitTimer.current = setTimeout(() => {
      apply();
      setAnim("entering");
    }, EXIT_MS);
  }

  function togglePlatform(kind: Social["kind"]) {
    queueChange(() => setPlatforms((prev) => (prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind])));
  }

  // REGISTERED makers come from the Cheer DB — the demo seeds alone made every real registration
  // invisible here. Their "received" totals are the honest mirrored donations (the indexer's book,
  // /api/feed), which start at $0 for a fresh page — no invented numbers.
  const [dbRows, setDbRows] = useState<{ handle: string; streamer: Profile; receivedAll: number; received7d: number; spark: number[] }[]>([]);
  useEffect(() => {
    let dead = false;
    void (async () => {
      try {
        // ?avatars=1 — this page is a wall of faces, so it's the one surface that needs the images.
        const [pr, fr] = await Promise.all([fetch("/api/profiles?avatars=1"), fetch("/api/feed?limit=200")]);
        if (!pr.ok) return;
        const { profiles } = (await pr.json()) as { profiles: Profile[] };
        const sums = new Map<string, { all: number; d7: number }>();
        if (fr.ok) {
          const { donations } = (await fr.json()) as { donations: { streamer: string; gross: number; blockTime: number | null }[] };
          const weekAgo = Date.now() / 1000 - 7 * 86400;
          for (const d of donations ?? []) {
            const cur = sums.get(d.streamer) ?? { all: 0, d7: 0 };
            const dollars = d.gross / 10 ** USDC_DECIMALS;
            cur.all += dollars;
            if ((d.blockTime ?? 0) >= weekAgo) cur.d7 += dollars;
            sums.set(d.streamer, cur);
          }
        }
        if (dead) return;
        setDbRows(
          (profiles ?? [])
            .filter((p) => !MOCK_STREAMERS[p.handle.toLowerCase()])
            .map((p) => {
              const sum = sums.get(p.address) ?? { all: 0, d7: 0 };
              return {
                handle: p.handle.toLowerCase(),
                streamer: p,
                receivedAll: Math.floor(sum.all),
                received7d: Math.floor(sum.d7),
                spark: Array(16).fill(0), // no mirrored history yet → a flat, honest line
              };
            })
        );
      } catch {}
    })();
    return () => {
      dead = true;
    };
  }, []);

  const rows = useMemo(() => {
    const demoRows = demoData ? MOCK_REALMS.map((r) => ({ ...r, streamer: MOCK_STREAMERS[r.handle] })).filter((r) => r.streamer) : [];
    const withStreamer = [...demoRows, ...dbRows];
    const q = query.trim().toLowerCase();
    const filtered = withStreamer.filter((r) => {
      const matchesQuery = !q || r.handle.includes(q) || r.streamer.name.toLowerCase().includes(q);
      const matchesPlatform = !platforms.length || (r.streamer.socials ?? []).some((s) => platforms.includes(s.kind));
      return matchesQuery && matchesPlatform;
    });
    return filtered.sort((a, b) => (sort === "all" ? b.receivedAll - a.receivedAll : b.received7d - a.received7d));
  }, [query, sort, platforms, dbRows, demoData]);

  const platformCounts = useMemo(() => {
    const counts = Object.fromEntries(SOCIAL_KINDS.map((k) => [k, 0])) as Record<Social["kind"], number>;
    // Only count demo streamers toward the platform filters when demo data is on — otherwise the
    // counts would advertise makers the catalog isn't actually showing.
    if (demoData) {
      for (const r of MOCK_REALMS) {
        const streamer = MOCK_STREAMERS[r.handle];
        if (!streamer) continue;
        for (const s of streamer.socials ?? []) counts[s.kind] += 1;
      }
    }
    for (const r of dbRows) for (const s of r.streamer.socials ?? []) counts[s.kind] += 1;
    return counts;
  }, [dbRows, demoData]);

  // A platform nobody here is on is a dead row: it can only ever filter the grid down to nothing.
  // Hide it. A platform that's currently SELECTED stays listed even at zero — the counts move as the
  // catalog changes, and dropping an active filter's own row would strand it with no way to switch
  // it off (the Clear button only appears alongside it).
  const shownPlatforms = useMemo(
    () => SOCIAL_KINDS.filter((k) => platformCounts[k] > 0 || platforms.includes(k)),
    [platformCounts, platforms]
  );

  return (
    <main className={styles.wrap}>
      <TopNav active="discover" />

      <div className={styles.main}>
        <div className={styles.searchRow}>
          <div className="search">
            <SearchIcon width={22} height={22} />
            <input type="text" aria-label="Search content makers" placeholder="Search content makers…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>

        <div className={styles.body}>
          <aside className={styles.sidebar}>
            <div className={styles.filterGroup}>
              <div className={styles.filterLabel}>Sort</div>
              <div className="seg">
                <button type="button" className={sort === "all" ? "active" : ""} onClick={() => sort !== "all" && queueChange(() => setSort("all"))}>
                  All-time
                </button>
                <button type="button" className={sort === "7d" ? "active" : ""} onClick={() => sort !== "7d" && queueChange(() => setSort("7d"))}>
                  7 days
                </button>
              </div>
            </div>

            {/* On an empty catalog every count is zero, which would leave the heading standing over
                nothing. Drop the whole group rather than show an empty filter. */}
            {shownPlatforms.length > 0 && (
            <div className={styles.filterGroup}>
              <div className={styles.filterHead}>
                <span className={styles.filterLabel}>Platforms</span>
                {platforms.length > 0 && (
                  <button
                    type="button"
                    className={styles.clearPlatforms}
                    onClick={() => queueChange(() => setPlatforms([]))}
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className={styles.platformList}>
                {shownPlatforms.map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    className={`${styles.platformRow} ${platforms.includes(kind) ? styles.platformOn : ""}`}
                    onClick={() => togglePlatform(kind)}
                    aria-pressed={platforms.includes(kind)}
                  >
                    <SocialIcon kind={kind} width={16} height={16} />
                    <span>{SOCIAL_LABEL[kind]}</span>
                    <span className={styles.platformCount}>{platformCounts[kind]}</span>
                  </button>
                ))}
              </div>
            </div>
            )}
          </aside>

          <div className={`${styles.grid} ${styles[anim]}`}>
            {rows.map((r) => (
              <Link key={r.handle} className={styles.card} href={`/@${r.handle}`}>
                <div className={styles.cardHead}>
                  <Mono name={r.streamer.name} size={40} src={r.streamer.avatarUrl} />
                  <div className={styles.cardWho}>
                    <span className={styles.cardHandle}>@{r.handle}</span>
                    <span className={styles.cardName}>{r.streamer.name}</span>
                  </div>
                </div>

                <div className={styles.cardSocials}>
                  {(r.streamer.socials ?? []).map((s) => (
                    <SocialIcon key={s.kind} kind={s.kind} width={16} height={16} />
                  ))}
                </div>

                <Spark data={sort === "all" ? r.spark : r.spark.slice(-7)} className={styles.spark} />

                <div className={styles.cardStats}>
                  <div className={styles.statLabel}>Received</div>
                  <div className={styles.statValue}>{money(sort === "all" ? r.receivedAll : r.received7d)}</div>
                </div>
              </Link>
            ))}

            {!rows.length && (
              <div className={styles.empty}>No content makers match your filters.</div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
