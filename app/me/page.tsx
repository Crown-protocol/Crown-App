"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useCheer } from "@/lib/data/DataProvider";
import { useSolanaWallet } from "@/lib/chain/wallet";
import { useMyReputation } from "@/lib/data/useMyReputation";
import { readDonorName, writeDonorName } from "@/lib/data/donorName";
import { DonateTopBar } from "@/components/DonateTopBar";
import { Logo } from "@/components/Logo";
import { Mono } from "@/components/Mono";
import { usd } from "@/lib/money";
import styles from "./page.module.css";

// The viewer's own page — the other half of the product. A maker has /space; this is where the
// person who PAYS can see what that got them: what they've given, where they stand with each maker,
// and the next rung on each ladder. Reputation is per-maker, never one global score
// (front.md I §4: $1 donated = 1 point with THAT maker), so the ladders are the page, not a footnote.
export default function MePage() {
  const { feed } = useCheer();
  const wallet = useSolanaWallet();
  const rep = useMyReputation();

  // The one viewer setting: the name donations are signed with.
  const [donorName, setDonorName] = useState("");
  const [nameSaved, setNameSaved] = useState(false);
  useEffect(() => setDonorName(readDonorName()), []);
  function saveDonorName() {
    writeDonorName(donorName);
    setDonorName(readDonorName());
    setNameSaved(true);
    setTimeout(() => setNameSaved(false), 1600);
  }

  // Your own donations out of the shared feed: matched by wallet (chain) or by the name you donate
  // under (mock). Best effort — the feed is the public stream, not a private ledger.
  const mine = useMemo(() => {
    // base58 is case-sensitive — comparing addresses through toLowerCase() never matches (that was
    // an EVM-era habit; a Solana pubkey uses both cases). Only the human name gets folded.
    const addr = wallet.address;
    const nm = readDonorName().trim().toLowerCase();
    return feed.filter((d) => {
      if (addr && d.payer === addr) return true;
      // Name matching is a mock-mode fallback only: two donors can pick the same name, so it must
      // never stand in for a wallet we actually know.
      if (!addr && nm && d.from.trim().toLowerCase() === nm) return true;
      return false;
    });
  }, [feed, wallet.address]);

  const given = mine.reduce((s, d) => s + d.amount, 0);

  return (
    <main className={styles.page}>
      <DonateTopBar />

      <div className={styles.wrap}>
        {/* ── header: who you are here ── */}
        <header className={styles.head}>
          <div className={styles.headText}>
            <h1 className={styles.title}>Your reputation</h1>
            <p className={styles.subtitle}>
              Every dollar you donate earns one point with that content maker — and climbs their ladder.
            </p>
          </div>
          {wallet.connected && wallet.address && (
            <span className={styles.walletPill}>
              <span className={styles.walletDot} aria-hidden />
              <span className="num">
                {wallet.address.slice(0, 4)}…{wallet.address.slice(-4)}
              </span>
            </span>
          )}
        </header>

        {/* ── the numbers ── */}
        <div className={styles.stats}>
          <div className={styles.stat}>
            <span className={`${styles.statNum} num`}>{rep.total}</span>
            <span className={styles.statLabel}>points</span>
          </div>
          <div className={styles.stat}>
            <span className={`${styles.statNum} num`}>{rep.makers.length}</span>
            <span className={styles.statLabel}>{rep.makers.length === 1 ? "maker" : "makers"}</span>
          </div>
          <div className={styles.stat}>
            <span className={`${styles.statNum} num`}>{given > 0 ? usd(given) : "—"}</span>
            <span className={styles.statLabel}>you&apos;ve given</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statNum}>{rep.bestTier?.name ?? "—"}</span>
            <span className={styles.statLabel}>best tier</span>
          </div>
        </div>

        {/* ── two columns: the ladders, and your activity ── */}
        <div className={styles.body}>
          <section className={styles.main} aria-labelledby="me-standing">
            <h2 id="me-standing" className={styles.sectionTitle}>
              Where you stand
            </h2>

            {rep.makers.length === 0 ? (
              <div className={styles.card}>
                <p className={styles.emptyText}>
                  You haven&apos;t donated yet. Find someone worth backing — your first dollar starts the ladder.
                </p>
                <Link className={styles.primary} href="/discover">
                  Find a content maker
                </Link>
              </div>
            ) : (
              <ul className={styles.ladders}>
                {rep.makers.map((m) => (
                  <li key={m.handle} className={styles.card}>
                    <Link href={`/@${m.handle}`} className={styles.makerHead}>
                      <Mono name={m.name} size={44} src={m.avatarEnabled !== false ? m.avatarUrl : undefined} />
                      <span className={styles.makerId}>
                        <span className={styles.makerName}>{m.name}</span>
                        <span className={styles.makerHandle}>@{m.handle}</span>
                      </span>
                      <span className={styles.makerPts}>
                        <span className={`${styles.makerNum} num`}>{m.rep}</span>
                        <span className={styles.makerUnit}>points</span>
                      </span>
                    </Link>

                    {/* The ladder itself: every tier this maker set, and where you sit on it. */}
                    <div className={styles.ladder}>
                      <div className={styles.track}>
                        <div className={styles.fill} style={{ width: `${m.pct}%` }} />
                      </div>
                      <div className={styles.rungs}>
                        {m.tiers.map((t) => {
                          const reached = m.rep >= t.threshold;
                          return (
                            <span key={t.name} className={`${styles.rung} ${reached ? styles.rungOn : ""}`}>
                              <span className={styles.rungName}>{t.name}</span>
                              <span className={`${styles.rungAt} num`}>{t.threshold}</span>
                            </span>
                          );
                        })}
                      </div>
                    </div>

                    <p className={styles.makerFoot}>
                      {m.next ? (
                        <>
                          <b className="num">{m.next.threshold - m.rep}</b> more to <b>{m.next.name}</b>
                        </>
                      ) : (
                        <>You&apos;re at the top of {m.name}&apos;s ladder.</>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <aside className={styles.side}>
            <section aria-labelledby="me-activity">
              <h2 id="me-activity" className={styles.sectionTitle}>
                Your donations
              </h2>
              <div className={styles.card}>
                {mine.length === 0 ? (
                  <p className={styles.emptyText}>
                    Nothing here yet. Donations you send show up as they settle.
                  </p>
                ) : (
                  <ul className={styles.acts}>
                    {mine.slice(0, 6).map((d) => (
                      <li key={d.id} className={styles.act}>
                        <span className={styles.actMain}>
                          <span className={`${styles.actAmt} num`}>{usd(d.amount)}</span>
                          <span className={styles.actWhen}>{d.time}</span>
                        </span>
                        {d.message && <span className={styles.actMsg}>{d.message}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            <section aria-labelledby="me-settings">
              <h2 id="me-settings" className={styles.sectionTitle}>
                Settings
              </h2>
              <div className={styles.card}>
                <label htmlFor="me-name" className={styles.fieldLabel}>
                  Name on donations
                </label>
                <div className={styles.fieldRow}>
                  <input
                    id="me-name"
                    type="text"
                    maxLength={40}
                    placeholder="Anonymous"
                    value={donorName}
                    onChange={(e) => setDonorName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveDonorName()}
                  />
                  <button type="button" className={styles.secondary} onClick={saveDonorName}>
                    {nameSaved ? "Saved" : "Save"}
                  </button>
                </div>
                <p className={styles.fieldHint}>Prefilled on every donate form.</p>
              </div>
            </section>
          </aside>
        </div>

        <div className={styles.footer}>
          <Logo />
        </div>
      </div>
    </main>
  );
}
