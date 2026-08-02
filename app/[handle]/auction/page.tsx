"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePublicProfile } from "@/lib/data/usePublicProfile";
import { useCrown } from "@/lib/data/DataProvider";
import { Logo } from "@/components/Logo";
import { ReputationDelta } from "@/components/ReputationDelta";
import { DonateTopBar } from "@/components/DonateTopBar";
import { Mono } from "@/components/Mono";
import { SocialIcon, SOCIAL_LABEL } from "@/components/icons";
import { normalizeSocialLink } from "@/lib/data/social-links";
import { auctionRules } from "@/lib/data/gameConfig";
import {
  withAuctionDefaults,
  readLots,
  addLot,
  ensureAuction,
  readAuctionMeta,
  castVote,
  leaderboard,
  lotSum,
  type AuctionLot,
  type AuctionMeta,
} from "@/lib/data/auction";
import { backgroundStyle, backgroundInk } from "@/lib/data/pagebuilder";
import { useIsWide } from "@/lib/data/useIsWide";
import { resolvePublicSession, pullSessions } from "@/lib/data/gameSessions";
import { useGameSync } from "@/lib/data/gameSync";
import { useGameChain } from "@/lib/chain/useGameChain";
import { auctionPlaceEntry, auctionVote } from "@/lib/chain/gameFlows";
import { GameTabs } from "@/components/games/GameTabs";
import { usd } from "@/lib/money";
import styles from "../roulette/page.module.css";
import au from "./auction.module.css";

type SendState = "idle" | "sending" | "done";

function fmtLeft(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

// The public auction page — the roulette page's shape, with the board where the wheel is:
// accepted lots richest-first, the leader lit up. One price, no haggling: a new lot costs the
// leading lot + $1 — outbid it or watch. Conditions stay private to the streamer until accepted;
// when the bell rings the top lot wins and everyone else is refunded.
export default function AuctionPage({ params }: { params: { handle: string } }) {
  const handle = decodeURIComponent(params.handle).replace(/^@/, "");
  // Resolve the content maker by handle from the Crown DB, so a viewer sees this page in any
  // browser — not just the owner whose localStorage holds the profile.
  const { profile: maker, status } = usePublicProfile(handle);
  const { getReputation } = useCrown();
  const isWide = useIsWide();

  // Session resolution: ?s=<id> picks one; a single live session resolves itself; several → the
  // picker; none → the gate. No sessions ever = legacy passthrough on the bare handle.
  const [pub, setPub] = useState<ReturnType<typeof resolvePublicSession> | null>(null);
  useEffect(() => {
    const sParam = new URLSearchParams(window.location.search).get("s");
    // Pull the shared session registry FIRST — a viewer's browser has never seen the streamer's
    // sessions, and without it ?s=<id> resolves to nothing and falls back to the legacy scope.
    let dead = false;
    void pullSessions(handle, "auction").then(() => {
      if (!dead) setPub(resolvePublicSession(handle, "auction", sParam));
    });
    return () => {
      dead = true;
    };
  }, [handle]);
  const scope = pub?.scope ?? null;

  // Shared game state: pulls the server copy into localStorage; the 1.5s interval below
  // already re-reads lots+meta from there, so other viewers' bids just show up.
  useGameSync(scope);

  const [lots, setLots] = useState<AuctionLot[]>([]);
  const [meta, setMeta] = useState<AuctionMeta | null>(null);
  const [now, setNow] = useState(0);
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [send, setSend] = useState<SendState>("idle");
  const [inc, setInc] = useState("1"); // the outbid step — +$1 by default, any +$x they like
  const [openBid, setOpenBid] = useState(""); // the opening bid on an empty board — blank = the maker's floor
  const [voted, setVoted] = useState(false);
  const [view, setView] = useState<"bid" | "board">("bid"); // the top toggle: place a bid vs. the standing lots
  const [chainErr, setChainErr] = useState("");
  const chain = useGameChain("auction");

  useEffect(() => {
    if (!scope) return;
    setLots(readLots(scope));
    setMeta(ensureAuction(scope));
    setNow(Date.now());
    const t = setInterval(() => {
      setNow(Date.now());
      setLots(readLots(scope));
      const m = readAuctionMeta(scope);
      if (m) setMeta(m);
    }, 1500);
    return () => clearInterval(t);
  }, [scope]);

  if (status === "loading") return <main className="page" />;

  const mine = maker;
  const auDraft = mine ? withAuctionDefaults(mine) : null;

  if (!mine || !auDraft) {
    return (
      <main className="page">
        <div className="center-note">
          <h1>No auction here</h1>
          <p>This content maker isn&apos;t running an auction right now.</p>
          <Link className="btn" href={`/@${handle}`}>
            To the content maker&apos;s page
          </Link>
        </div>
      </main>
    );
  }

  // The rules THIS session was opened with — a bidder must see the step and the windows the run
  // is actually running under, not the maker's current profile defaults.
  const cfg = auctionRules(mine, scope);
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
              <p>Nothing is live. Start a session in your space — Auction → Sessions — and this page switches on.</p>
              <Link className="btn" href={`/@${handle}`}>
                To the content maker&apos;s page
              </Link>
            </>
          )}
        </div>
      </main>
    );
  }

  if (!meta) return <main className="page" />;

  const board = leaderboard(lots);
  const winner = meta.winnerId ? lots.find((l) => l.id === meta.winnerId) ?? null : null;
  const state = meta.state;
  const bidding = state === "bidding";
  const msLeft = meta.startedAt + cfg.biddingHours * 3_600_000 - now;

  const topSum = board[0] ? lotSum(board[0]) : 0;
  // The pricing model: beat the leader by your own step (+$1 by default), or open at the price
  // the streamer fixed when this auction was created (legacy auctions fall back to settings).
  const minBid = meta.minBid ?? cfg.minBid;
  // The maker sets the SMALLEST allowed outbid step; a viewer may step up by more, never less.
  const minStep = Math.max(1, Math.round(cfg.minIncrement ?? 1));
  const step = Math.max(minStep, Math.round(Number(inc)) || minStep);
  // Opening an empty board works the same way: the maker's price is a FLOOR, not a fixed ticket —
  // a viewer who wants the lead from the first move can open above it. Blank = open at the floor.
  const opening = Math.max(minBid, Math.round(Number(openBid)) || minBid);
  const bid = board.length ? topSum + step : opening;
  const canSend = send === "idle" && bidding && text.trim().length > 0;
  const rep = getReputation(handle);

  async function submitLot() {
    if (!canSend) return;
    setChainErr("");
    setSend("sending");
    // Chain path: the auction lives on its canister — escrow birth against the (auction, text)
    // resolver, register_entry, then the synced book mirrors it.
    if (chain.live && meta?.chainAuction) {
      if (!chain.wallet) {
        setChainErr("Connect your wallet — lots here are real escrow.");
        setSend("idle");
        return;
      }
      const res = await auctionPlaceEntry(chain.wallet, {
        auctionHex: meta.chainAuction,
        recipient: mine!.address,
        dollars: bid,
        deadlineHours: cfg.biddingHours + cfg.performHours + 168, // escrow must outlive the bell + delivery + the vote
        text,
        handle,
      });
      if (!res.ok) {
        setChainErr(res.error);
        setSend("idle");
        return;
      }
      setLots(addLot(scope!, { from: name, amount: bid, text, chainLot: res.lotHex, escrow: res.escrow }));
      setText("");
      setSend("done");
      setTimeout(() => setSend("idle"), 2400);
      return;
    }
    // Mock path — the demo simulation, exactly as before.
    setTimeout(() => {
      setLots(addLot(scope!, { from: name, amount: bid, text }));
      setText("");
      setSend("done");
      setTimeout(() => setSend("idle"), 2400);
    }, 1100);
  }

  function vote(choice: "done" | "not_done") {
    // Mock: any visitor votes once with a flat weight — the real gate is reputation with
    // this streamer, checked by the canister (game-spec §10). When the canister is live the
    // same click also casts the REAL ledger-weighted vote (dual-write; canister enforces).
    if (chain.live && chain.wallet && meta?.chainAuction) void auctionVote(chain.wallet, meta.chainAuction, choice);
    setMeta(castVote(scope!, { name: name || `guest-${Date.now() % 10000}`, weight: 10, choice }));
    setVoted(true);
  }

  return (
    <main className={`${styles.page}${backgroundInk(auDraft.design) === "light" ? " on-light" : ""}`} style={backgroundStyle(auDraft.design, isWide)}>
      <DonateTopBar />
      <div className={styles.col}>
        <Link className={styles.who} href={`/@${handle}`} style={{ textDecoration: "none", color: "inherit" }} title={`@${mine.handle} — open profile`}>
          {mine.avatarEnabled !== false && <Mono name={mine.name} size={56} src={mine.avatarUrl} />}
          <div>
            <div className={styles.name}>{mine.name}</div>
            <div className={styles.handle}>
              @{mine.handle} ·{" "}
              <span className={styles.live}>
                {bidding ? `bidding open · ${fmtLeft(msLeft)} left` : state === "performing" ? "sold — delivering" : state === "voting" ? "voting" : "closed"}
              </span>
            </div>
          </div>
        </Link>

        <h1 className={styles.headline}>{auDraft.headline.trim() || "Name your price — the top lot owns my time"}</h1>
        {auDraft.descriptionEnabled && auDraft.description && <p className={styles.desc}>{auDraft.description}</p>}

        {/* Top toggle: the bidding form, or the standing board of lots. One at a time keeps the
            page a single focused column instead of two half-empty ones. */}
        <GameTabs
          value={view}
          onChange={(v) => setView(v as "bid" | "board")}
          tabs={[
            { key: "bid", label: "Place a bid" },
            { key: "board", label: "The board", count: board.length },
          ]}
        />

        <div className={au.panel}>
          {/* the board — richest first, the leader carries the accent */}
          {view === "board" && (
            <div className={au.board}>
              {board.length === 0 ? (
                <div className={au.empty}>No lots on the board yet — yours would open it.</div>
              ) : (
                board.map((l, i) => (
                  // The board resolves top-down: each rank enters a beat after the one above it.
                  <div
                    key={l.id}
                    className={`${au.lot}${i === 0 ? " " + au.lotLead : ""}`}
                    style={{ animationDelay: `${Math.min(i, 7) * 45}ms` }}
                  >
                    <span className={au.rank}>#{i + 1}</span>
                    <span className={au.lotBody}>
                      <span className={au.lotText}>{l.text}</span>
                      <span className={au.lotBar} aria-hidden>
                        <span className={au.lotFill} style={{ width: `${Math.max(4, Math.round((lotSum(l) / (topSum || 1)) * 100))}%` }} />
                      </span>
                    </span>
                    <span style={{ textAlign: "right" }}>
                      <span className={`${au.lotSum} num`}>{usd(lotSum(l))}</span>
                      {winner?.id === l.id && (
                        <div>
                          <span className={`pill ${state === "settled" ? "ok" : "wait"}`} style={{ marginTop: 6 }}>
                            <span className="dot" />
                            {state === "settled" ? "paid out" : state === "refunded" ? "refunded" : "won"}
                          </span>
                        </div>
                      )}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}

          {view === "bid" && (
          <div className={`${styles.stack} ${au.auFormCol}`}>
            {/* The money on the line, stated big — the leading bid IS the headline number here. */}
            <div className={au.leadBar}>
              <div className={au.leadNum}>
                <span className={`${au.leadAmt} num`}>{usd(topSum)}</span>
                <span className={au.leadLabel}>top bid</span>
              </div>
              <div className={au.leadClock}>
                {bidding ? (
                  <>
                    <span className={`${au.leadTime} num`}>{fmtLeft(msLeft)}</span>
                    <span className={au.leadLabel}>left to bid</span>
                  </>
                ) : (
                  <span className={au.leadClosed}>Bidding closed</span>
                )}
              </div>
            </div>

            {bidding && auDraft.widgets.find((w) => w.kind === "donate")?.enabled && (
              <div className={styles.suggestCard} style={{ maxWidth: "none" }}>
                <div className="field">
                  <input type="text" placeholder="Your name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="field">
                  <textarea
                    rows={3}
                    placeholder={`Your condition — only ${mine.name} sees it for now`}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                  />
                </div>
                <ReputationDelta rep={rep} gain={bid} tiers={mine.tiers} />
                <div className={au.bidRow} style={{ display: "flex", gap: 10 }}>
                  {board.length > 0 ? (
                    <div className="field" style={{ flex: "0 0 104px" }} title="Your outbid step">
                      <div className="affix has-pre">
                        <span className="affix-pre">+$</span>
                        <input
                          type="number"
                          min={minStep}
                          aria-label="Outbid step"
                          placeholder={String(minStep)}
                          value={inc}
                          onChange={(e) => setInc(e.target.value)}
                          onBlur={() => {
                            // Snap a below-minimum entry up to the maker's floor, so the shown step
                            // and the actual bid always agree.
                            const n = Math.round(Number(inc));
                            if (!n || n < minStep) setInc(String(minStep));
                          }}
                          style={{ paddingLeft: 38, height: 56 }}
                        />
                      </div>
                    </div>
                  ) : (
                    /* Empty board: the same knob, but on the whole bid instead of a step — the
                       maker's price is the floor, and opening above it is allowed. */
                    <div
                      className="field"
                      style={{ flex: "0 0 116px" }}
                      title={`Your opening bid — ${mine.name}'s floor is ${usd(minBid)}`}
                    >
                      <div className="affix has-pre">
                        <span className="affix-pre">$</span>
                        <input
                          type="number"
                          min={minBid}
                          aria-label="Opening bid"
                          placeholder={String(minBid)}
                          value={openBid}
                          onChange={(e) => setOpenBid(e.target.value)}
                          onBlur={() => {
                            // Snap a below-floor entry up, so the shown amount and the actual bid agree.
                            const n = Math.round(Number(openBid));
                            if (!n || n < minBid) setOpenBid(String(minBid));
                          }}
                          style={{ height: 56 }}
                        />
                      </div>
                    </div>
                  )}
                  {chainErr && (
                  <div className="footnote" style={{ color: "var(--error)" }}>
                    {chainErr}
                  </div>
                )}
                <button type="button" className="btn" style={{ flex: 1 }} disabled={!canSend} onClick={() => void submitLot()}>
                    {send === "sending" ? "Placing…" : send === "done" ? "In escrow ✓" : board.length ? `Outbid · ${usd(bid)}` : `Open the bidding · ${usd(bid)}`}
                  </button>
                </div>
                {send === "done" && (
                  <div className="footnote" style={{ textAlign: "center" }}>Sent — {mine.name} decides. Turned down = instant refund.</div>
                )}
              </div>
            )}

            {state === "performing" && winner && (
              <div className={styles.roundCard}>
                <div className={styles.roundFoot}>
                  Sold for <b className="num">{usd(lotSum(winner))}</b> — {mine.name} is delivering: “{winner.text}”. Reputation
                  holders vote here once they hit Done.
                </div>
              </div>
            )}

            {state === "voting" && winner && (
              <div className={styles.suggestCard} style={{ maxWidth: "none" }}>
                <div className={styles.roundFoot} style={{ textAlign: "center" }}>
                  Did {mine.name} deliver “{winner.text}”?
                </div>
                {voted ? (
                  <div className="footnote" style={{ textAlign: "center" }}>
                    Vote in — <b className="num">{meta.votes.done}</b> delivered · <b className="num">{meta.votes.notDone}</b> not.
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                    <button type="button" className="btn" onClick={() => vote("done")}>
                      Delivered
                    </button>
                    <button type="button" className="btn-outline" onClick={() => vote("not_done")}>
                      Not delivered
                    </button>
                  </div>
                )}
              </div>
            )}

            {(state === "settled" || state === "refunded" || state === "cancelled") && (
              <div className={styles.roundCard}>
                <div className={styles.roundFoot} style={{ textAlign: "center" }}>
                  {state === "settled" && winner
                    ? `Delivered and confirmed — ${usd(lotSum(winner))} went to ${mine.name}, backers earned reputation.`
                    : state === "refunded"
                      ? "The vote didn't confirm delivery — everyone was refunded in full."
                      : "The auction was cancelled — every lot was refunded in full."}
                </div>
              </div>
            )}
          </div>
          )}
        </div>

        {bidding && !auDraft.widgets.find((w) => w.kind === "donate")?.enabled && (
          <div className={`card ${styles.roundCard}`}>
            <div className="footnote" style={{ textAlign: "center" }}>
              {mine.name} isn&apos;t taking bids right now.
            </div>
          </div>
        )}

        {auDraft.widgets.find((w) => w.kind === "socials")?.enabled && (
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
    </main>
  );
}
