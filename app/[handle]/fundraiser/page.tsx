"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePublicProfile } from "@/lib/data/usePublicProfile";
import { useCrown } from "@/lib/data/DataProvider";
import { Logo } from "@/components/Logo";
import { ReputationDelta } from "@/components/ReputationDelta";
import { DonateTopBar } from "@/components/DonateTopBar";
import { Mono } from "@/components/Mono";
import { FundraiserFill } from "@/components/FundraiserFill";
import { SocialIcon, SOCIAL_LABEL, CopyIcon } from "@/components/icons";
import { normalizeSocialLink } from "@/lib/data/social-links";
import { usd } from "@/lib/money";
import { fundraiserRules } from "@/lib/data/gameConfig";
import { withFundraiserDefaults, readCollected, addCollected, readStatus, type FundraiserStatus } from "@/lib/data/fundraiser";
import { useGameChain } from "@/lib/chain/useGameChain";
import { fundingChipIn } from "@/lib/chain/gameFlows";
import { resolvePublicSession, pullSessions } from "@/lib/data/gameSessions";
import { useGameSync } from "@/lib/data/gameSync";
import { backgroundStyle, backgroundInk } from "@/lib/data/pagebuilder";
import { useIsWide } from "@/lib/data/useIsWide";
import styles from "./page.module.css";

type SendState = "idle" | "sending" | "done";

// The public fundraiser page — what a viewer opens from the streamer's link or QR. The content
// maker is resolved by handle from the Crown DB (usePublicProfile), so the page renders for any
// visitor; chip-ins accumulate in localStorage (the mock backend) so the crown fills up when you
// try it, until the indexer owns that total.
export default function FundraiserPage({ params }: { params: { handle: string } }) {
  const handle = decodeURIComponent(params.handle).replace(/^@/, "");
  // Resolve the content maker by handle from the Crown DB, so a viewer sees this page in any
  // browser — not just the owner whose localStorage holds the profile.
  const { profile: maker, status } = usePublicProfile(handle);
  const { getReputation } = useCrown();
  const isWide = useIsWide();

  // Session resolution: ?s=<id> picks a specific session; one live session resolves itself;
  // several → the picker below; none → the "nothing running" gate. Streamers who never used
  // sessions fall through on the bare handle (legacy data keeps working).
  const [pub, setPub] = useState<ReturnType<typeof resolvePublicSession> | null>(null);
  useEffect(() => {
    const sParam = new URLSearchParams(window.location.search).get("s");
    // Pull the shared session registry FIRST — a viewer's browser has never seen the streamer's
    // sessions, and without it ?s=<id> resolves to nothing and falls back to the legacy scope.
    let dead = false;
    void pullSessions(handle, "fundraiser").then(() => {
      if (!dead) setPub(resolvePublicSession(handle, "fundraiser", sParam));
    });
    return () => {
      dead = true;
    };
  }, [handle]);
  const scope = pub?.scope ?? null;

  const [collected, setCollected] = useState(0);
  const [frStatus, setFrStatus] = useState<FundraiserStatus>({ state: "collecting" });
  const [chainErr, setChainErr] = useState("");
  const chain = useGameChain("fundraiser");
  const [amount, setAmount] = useState<number | null>(null);
  const [custom, setCustom] = useState("");
  const [send, setSend] = useState<SendState>("idle");
  const [copied, setCopied] = useState(false);

  // Shared game state: other viewers' chip-ins land in `collected` via the nonce dep.
  const syncNonce = useGameSync(scope);

  useEffect(() => {
    if (!scope) return;
    setCollected(readCollected(scope));
    setFrStatus(readStatus(scope));
  }, [scope, syncNonce]);

  if (status === "loading") return <main className="page" />;

  const mine = maker;
  const fr = mine ? withFundraiserDefaults(mine) : null;

  if (!mine || !fr) {
    return (
      <main className="page">
        <div className="center-note">
          <h1>No active fundraiser</h1>
          <p>This content maker isn't collecting toward a goal right now.</p>
          <Link className="btn" href={`/@${handle}`}>
            To the content maker's page
          </Link>
        </div>
      </main>
    );
  }

  // The rules THIS collection was opened with — its own goal and minimum, not the page's defaults.
  const cfg = fundraiserRules(mine, scope);
  if (!pub) return <main className="page" />;
  if (!pub.scope) {
    return (
      <main className="page">
        <div className="center-note">
          <h1>{pub.choices.length ? "Pick a session" : "Nothing running right now"}</h1>
          {pub.choices.length ? (
            <>
              <p>Several are live at once — choose the one you were invited to.</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
                {pub.choices.map((c) => (
                  <a key={c.id} className="btn" href={`?s=${c.id}`}>
                    {c.name}
                  </a>
                ))}
              </div>
            </>
          ) : (
            <>
              <p>Nothing is live. Start a session in your space — Fundraiser → Sessions — and this page switches on.</p>
              <Link className="btn" href={`/@${handle}`}>
                To the content maker&apos;s page
              </Link>
            </>
          )}
        </div>
      </main>
    );
  }

  // The goal belongs to the RUN, not to the page: cfg.goal is what this collection was opened for.
  const goal = cfg.goal;
  const pct = goal > 0 ? Math.min(1, collected / goal) : 0;
  const reached = goal > 0 && collected >= goal;
  const chosen = amount ?? fr.presets[0];
  const customN = Math.round(Number(custom)) || 0;
  const finalAmount = custom ? customN : chosen;
  // Once the goal is met the collection is done — no more chip-ins (strict where money is): the
  // streamer moves to delivering, so we stop taking money instead of silently overfunding.
  const canSend = send === "idle" && !reached && finalAmount >= cfg.minContribution;
  const rep = getReputation(handle);

  async function chipIn() {
    if (!canSend) return;
    setChainErr("");
    setSend("sending");
    // Chain path: the collection lives on the funding canister — escrow birth against its
    // resolver key, then the synced total mirrors it.
    if (chain.live && frStatus.chainCollection) {
      if (!chain.wallet) {
        setChainErr("Connect your wallet — chip-ins here are real escrow.");
        setSend("idle");
        return;
      }
      const res = await fundingChipIn(chain.wallet, {
        collectionHex: frStatus.chainCollection,
        recipient: mine!.address,
        dollars: finalAmount,
        deadlineDays: cfg.fundingDays + cfg.deliveryDays + 14, // escrow must outlive delivery + the vote
      });
      if (!res.ok) {
        setChainErr(res.error);
        setSend("idle");
        return;
      }
      setCollected(addCollected(scope!, finalAmount));
      setSend("done");
      setTimeout(() => setSend("idle"), 2200);
      return;
    }
    // Mock path — the demo simulation, exactly as before.
    setTimeout(() => {
      setCollected(addCollected(scope!, finalAmount));
      setSend("done");
      setTimeout(() => setSend("idle"), 2200);
    }, 1100);
  }

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(mine!.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {}
  }

  return (
    <main className={`${styles.page}${backgroundInk(fr.design) === "light" ? " on-light" : ""}`} style={backgroundStyle(fr.design, isWide)}>
      <DonateTopBar />
      <div className={styles.col}>
        <Link className={styles.who} href={`/@${handle}`} style={{ textDecoration: "none", color: "inherit" }} title={`@${mine.handle} — open profile`}>
          {mine.avatarEnabled !== false && <Mono name={mine.name} size={56} src={mine.avatarUrl} />}
          <div>
            <div className={styles.name}>{mine.name}</div>
            <div className={styles.handle}>@{mine.handle} · <span className={styles.live}>{reached ? "goal reached" : "active"}</span></div>
          </div>
        </Link>

        <h1 className={styles.pledge}>{fr.pledge.trim() || "Help me hit the goal"}</h1>
        {fr.descriptionEnabled && fr.description && <p className={styles.desc}>{fr.description}</p>}
        <p className={styles.refundNote}>Delivered — the money is theirs. Not delivered — everyone gets it back.</p>

        <FundraiserFill pct={pct} size={128} image={fr.fillImage} />
        <div className={`${styles.pct} num`}>{Math.round(pct * 100)}%</div>
        <div className={`${styles.sums} num`}>
          {usd(collected)} <span>of {usd(goal)}</span>
        </div>
        <div className={styles.left}>
          {reached
            ? `Goal reached · ${usd(collected)} raised`
            : `${usd(Math.max(0, goal - collected))} to go · ${cfg.fundingDays} ${cfg.fundingDays === 1 ? "day" : "days"} left`}
        </div>

        {reached ? (
          <div className={`card ${styles.chipInCard}`}>
            <div className={styles.reachedTitle}>Goal reached 🎉</div>
            <div className="footnote">
              Collection is closed — {mine.name} has what they need and is on it. Backers are refunded automatically if
              it isn&apos;t delivered.
            </div>
          </div>
        ) : fr.widgets.find((w) => w.kind === "donate")?.enabled ? (
          <div className={`card ${styles.chipInCard}`}>
            <div className="chips" style={{ justifyContent: "center" }}>
              {fr.presets.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`chip${!custom && chosen === p ? " active" : ""}`}
                  onClick={() => {
                    setAmount(p);
                    setCustom("");
                  }}
                >
                  ${p}
                </button>
              ))}
              <input
                className={styles.customAmount}
                type="number"
                min={cfg.minContribution}
                placeholder="Custom"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
              />
            </div>
            <ReputationDelta rep={rep} gain={finalAmount} tiers={mine.tiers} />
            <button type="button" className="btn" disabled={!canSend} onClick={() => void chipIn()}>
              {send === "sending" ? "Sending…" : send === "done" ? "In escrow ✓" : `Chip in ${usd(finalAmount)}`}
            </button>
            <div className="footnote">
              {send === "done"
                ? "Held in escrow until delivery — refunded automatically if it doesn't happen."
                : `From ${usd(cfg.minContribution)}. Your money sits in escrow, not in anyone's pocket.`}
            </div>
          </div>
        ) : (
          <div className={`card ${styles.chipInCard}`}>
            <div className="footnote" style={{ textAlign: "center" }}>
              {mine.name} isn&apos;t taking chip-ins right now.
            </div>
          </div>
        )}

        {fr.widgets.find((w) => w.kind === "socials")?.enabled && (
          <div className={styles.socials}>
            {mine.socials.map((s) => {
              const safe = normalizeSocialLink(s.kind, s.url);
              if (!safe) return null;
              return (
                <a key={s.kind} href={safe} target="_blank" rel="noreferrer nofollow" aria-label={SOCIAL_LABEL[s.kind]}>
                  <SocialIcon kind={s.kind} />
                </a>
              );
            })}
          </div>
        )}

        <div className={styles.shareRow}>
          {mine.address && (
            <button type="button" className={styles.addr} onClick={copyAddress} title="Copy payout address">
              <span className="num">{mine.address.slice(0, 6)}…{mine.address.slice(-4)}</span>
              <CopyIcon /> {copied ? "Copied!" : ""}
            </button>
          )}
        </div>

        <div className={styles.footer}>
          <Logo />
        </div>
      </div>
    </main>
  );
}
