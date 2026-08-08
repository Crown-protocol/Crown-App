"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePublicProfile } from "@/lib/data/usePublicProfile";
import { useCheer } from "@/lib/data/DataProvider";
import { Logo } from "@/components/Logo";
import { ReputationDelta } from "@/components/ReputationDelta";
import { DonateTopBar } from "@/components/DonateTopBar";
import { Mono } from "@/components/Mono";
import { SocialIcon, SOCIAL_LABEL } from "@/components/icons";
import { normalizeSocialLink } from "@/lib/data/social-links";
import { usd } from "@/lib/money";
import { taskRules } from "@/lib/data/gameConfig";
import { withTaskPageDefaults, readTasks, addTask, activeCount, type GameTask } from "@/lib/data/tasks";
import { backgroundStyle, backgroundInk } from "@/lib/data/pagebuilder";
import { useIsWide } from "@/lib/data/useIsWide";
import { resolvePublicSession, pullSessions } from "@/lib/data/gameSessions";
import { useGameSyncState } from "@/lib/data/gameSync";
import { useGameChain } from "@/lib/chain/useGameChain";
import { useConfirm } from "@/components/useConfirm";
import { dangerCopy } from "@/lib/data/dangerous";
import { taskStartOnChain } from "@/lib/chain/gameFlows";
import { GameTabs } from "@/components/games/GameTabs";
import { GameRules, taskLines } from "@/components/games/GameRules";
import styles from "./page.module.css";

type SendState = "idle" | "sending" | "done";

// The public task page — what a viewer opens from the link or QR to set a paid task. The content
// maker is resolved by handle from the Cheer DB (usePublicProfile), so the page renders for any
// visitor; the task queue still accumulates in localStorage (the mock backend) until the indexer
// owns it, so a task set here shows up in the streamer's Task → Overview tab in the same browser.
export default function TaskPage({ params }: { params: { handle: string } }) {
  const handle = decodeURIComponent(params.handle).replace(/^@/, "");
  // Resolve the content maker by handle from the Cheer DB, so a viewer sees this page in any
  // browser — not just the owner whose localStorage holds the profile.
  const { profile: maker, status } = usePublicProfile(handle);
  const { getReputation } = useCheer();
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
    void pullSessions(handle, "task").then(() => {
      if (!dead) setPub(resolvePublicSession(handle, "task", sParam));
    });
    return () => {
      dead = true;
    };
  }, [handle]);
  const scope = pub?.scope ?? null;

  const [queue, setQueue] = useState<GameTask[]>([]);
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState<number | null>(null);
  const [custom, setCustom] = useState("");
  const [send, setSend] = useState<SendState>("idle");
  const [durationH, setDurationH] = useState<number | null>(null); // the donor's deadline pick
  const [view, setView] = useState<"set" | "queue" | "rules">("set"); // the top toggle: set a task vs. what's already on the list
  const [chainErr, setChainErr] = useState("");
  const chain = useGameChain("task");
  const confirm = useConfirm(); // paying for a task is real escrow — ask first

  // Shared game state: pulls the server copy on mount and every few seconds — other viewers'
  // tasks land in `queue` via the nonce dep below.
  const { nonce: syncNonce, synced } = useGameSyncState(scope);

  useEffect(() => {
    if (!scope) return;
    setQueue(readTasks(scope));
  }, [scope, syncNonce]);

  if (status === "loading") return <main className="page" />;

  const mine = maker;
  const tp = mine ? withTaskPageDefaults(mine) : null;

  if (!mine || !tp) {
    return (
      <main className="page">
        <div className="center-note">
          <h1>No tasks here</h1>
          <p>This content maker isn&apos;t taking paid tasks right now.</p>
          <Link className="btn" href={`/@${handle}`}>
            To the content maker&apos;s page
          </Link>
        </div>
      </main>
    );
  }

  // The rules THIS session was opened with — a viewer must see the minimum and the deadline the
  // run is actually taking money under, not the maker's current profile defaults.
  const cfg = taskRules(mine, scope);
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
              <p>Nothing is live. Start a session in your space — Task for donation → Sessions — and this page switches on.</p>
              <Link className="btn" href={`/@${handle}`}>
                To the content maker&apos;s page
              </Link>
            </>
          )}
        </div>
      </main>
    );
  }

  const running = activeCount(queue);
  const full = running >= cfg.maxActiveTasks;

  const chosen = amount ?? tp.presets[0];
  const customN = Math.round(Number(custom)) || 0;
  const finalAmount = custom ? customN : chosen;
  // `synced`: until the server has answered, the minimum and the deadline shown may be the maker's
  // current defaults rather than the ones this run was opened with — and those defaults are editable
  // mid-run. No money moves under terms we can't vouch for.
  const canSend = send === "idle" && !full && synced && text.trim().length > 0 && finalAmount >= cfg.minAmount;

  // $1 donated = 1 reputation (front.md I §4) — so this task's amount is exactly the gain.
  const rep = getReputation(handle);
  const durationHours = durationH ?? Math.min(24, cfg.deadlineHours);

  function finishSubmit(escrow?: string) {
    setQueue(addTask(scope!, { from: name, amount: finalAmount, text, requireApproval: cfg.requireApproval, durationHours, ...(escrow ? { escrow } : {}) }));
    setText("");
    setCustom("");
    setSend("done");
    setTimeout(() => setSend("idle"), 2400);
  }

  async function submit() {
    if (!canSend) return;
    setChainErr("");
    setSend("sending");
    // Chain path: the task canister is live — real escrow first, the synced queue mirrors it.
    if (chain.live) {
      if (!chain.wallet) {
        setChainErr("Connect your wallet — tasks here are real escrow.");
        setSend("idle");
        return;
      }
      const res = await taskStartOnChain(chain.wallet, { recipient: mine!.address, dollars: finalAmount, durationHours, text, handle });
      if (!res.ok) {
        setChainErr(res.error);
        setSend("idle");
        return;
      }
      finishSubmit(res.escrow);
      return;
    }
    // Mock path — the demo simulation, exactly as before.
    setTimeout(() => finishSubmit(), 1100);
  }


  return (
    <main className={`${styles.page}${backgroundInk(tp.design) === "light" ? " on-light" : ""}`} style={backgroundStyle(tp.design, isWide)}>
      <DonateTopBar />
      <div className={styles.col}>
        <Link className={styles.who} href={`/@${handle}`} style={{ textDecoration: "none", color: "inherit" }} title={`@${mine.handle} — open profile`}>
          {mine.avatarEnabled !== false && <Mono name={mine.name} size={56} src={mine.avatarUrl} />}
          <div>
            <div className={styles.name}>{mine.name}</div>
            <div className={styles.handle}>
              @{mine.handle} · <span className={styles.live}>{full ? "queue full" : "taking tasks"}</span>
            </div>
          </div>
        </Link>

        {/* No stand-in headline: the pitch is required in the builder, and inventing one here
            made an unfinished page look finished (the preview showed words nobody wrote). */}
        {tp.headline.trim() && <h1 className={styles.headline}>{tp.headline}</h1>}
        {tp.descriptionEnabled && tp.description && <p className={styles.desc}>{tp.description}</p>}

        {/* Tab 1: set a task. Tab 2: what other viewers have already set, and where each stands. */}
        <GameTabs
          value={view}
          onChange={(v) => setView(v as "set" | "queue" | "rules")}
          tabs={[
            { key: "set", label: "Set a task" },
            { key: "queue", label: "On the list", count: running },
            { key: "rules", label: "Rules" },
          ]}
        />

        {view === "rules" && <GameRules lines={taskLines(cfg, mine.name)} mine={mine} />}

        {view === "queue" && (
          <div className={styles.queue}>
            {queue.length === 0 ? (
              <div className="footnote" style={{ textAlign: "center", padding: "12px 0" }}>
                No tasks yet — yours would be the first.
              </div>
            ) : (
              queue.map((t, i) => (
                // The list cascades in rather than appearing all at once, and settled tasks step
                // back so whatever is running now leads the eye.
                <div
                  key={t.id}
                  className={`${styles.task}${t.state === "active" ? ` ${styles.taskLive}` : ""}${
                    t.state === "done" || t.state === "refunded" ? ` ${styles.taskPast}` : ""
                  }`}
                  style={{ animationDelay: `${Math.min(i, 7) * 45}ms` }}
                >
                  <span className={styles.taskText}>{t.text}</span>
                  <span className={`${styles.taskAmt} num`}>{usd(t.amount)}</span>
                  <span
                    className={`pill ${
                      t.state === "done" ? "ok" : t.state === "refunded" ? "bad" : t.state === "active" ? "attn" : "wait"
                    }`}
                  >
                    <span className="dot" />
                    {t.state === "pending" ? "awaiting" : t.state === "active" ? "in progress" : t.state === "done" ? "done" : "refunded"}
                  </span>
                </div>
              ))
            )}
          </div>
        )}

        {view === "set" && tp.widgets.find((w) => w.kind === "donate")?.enabled && (
          <div className={`card ${styles.form}`}>
            <div className="field">
              <input type="text" placeholder="Your name (optional)" value={name} onChange={(e) => setName(e.target.value)} disabled={full} />
            </div>
            <div className="field">
              <textarea
                rows={3}
                placeholder="What should they do?"
                value={text}
                onChange={(e) => setText(e.target.value)}
                disabled={full}
              />
            </div>

            {/* The deadline is the DONOR's knob (game-spec §7): pick within the
                streamer's ceiling. Chips filtered so nothing above it shows. */}
            <div className="chips" style={{ justifyContent: "center" }}>
              {[6, 24, 72].filter((h) => h <= cfg.deadlineHours).map((h) => (
                <button
                  key={`d${h}`}
                  type="button"
                  className={`chip${(durationH ?? Math.min(24, cfg.deadlineHours)) === h ? " active" : ""}`}
                  disabled={full}
                  onClick={() => setDurationH(h)}
                >
                  {h < 24 ? `${h}h` : `${h / 24}d`}
                </button>
              ))}
            </div>

            <div className="chips" style={{ justifyContent: "center" }}>
              {tp.presets.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`chip${!custom && chosen === p ? " active" : ""}`}
                  disabled={full}
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
                min={cfg.minAmount}
                placeholder="Custom"
                value={custom}
                disabled={full}
                onChange={(e) => setCustom(e.target.value)}
              />
            </div>

            {/* What this task does to your standing with them: $1 = 1 point, so the amount above
                is the gain. Shared with the other mini-games via ReputationDelta. */}
            <ReputationDelta rep={rep} gain={finalAmount} tiers={mine.tiers} />

            {chainErr && (
              <div className="footnote" style={{ color: "var(--error)" }}>
                {chainErr}
              </div>
            )}
            <button
              type="button"
              className="btn"
              disabled={!canSend}
              onClick={() => confirm(chain.live ? dangerCopy.task(finalAmount) : dangerCopy.demoGame(finalAmount), () => void submit())}
            >
              {send === "sending"
                ? "Sending…"
                : send === "done"
                  ? chain.live
                    ? "In escrow ✓"
                    : "Preview ✓"
                  : `Set the task · ${usd(finalAmount)}`}
            </button>

            <div className="footnote">
              {full
                ? `The queue is full — ${mine.name} takes ${cfg.maxActiveTasks} at a time. Try again once one wraps up.`
                : send === "done"
                  ? !chain.live
                    ? "Preview only — no money moved and nothing is in escrow. This is how the flow will look once it's live."
                    : cfg.requireApproval
                      ? "Sent — it's waiting for them to accept. Declined or missed, and you're refunded."
                      : "Sent — the clock is already running."
                  : `From ${usd(cfg.minAmount)} · you pick the deadline, up to ${cfg.deadlineHours}h.`}
            </div>
          </div>
        )}

        {view === "set" && !tp.widgets.find((w) => w.kind === "donate")?.enabled && (
          <div className={`card ${styles.form}`}>
            <div className="footnote" style={{ textAlign: "center" }}>
              {mine.name} isn&apos;t taking tasks right now.
            </div>
          </div>
        )}

        {tp.widgets.find((w) => w.kind === "socials")?.enabled && (
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


        <div className={styles.footer}>
          <Logo />
        </div>
      </div>
      {confirm.dialog}
    </main>
  );
}
