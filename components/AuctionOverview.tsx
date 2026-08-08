"use client";

import { useEffect, useState } from "react";
import { useGameSync } from "@/lib/data/gameSync";
import { useGameChain } from "@/lib/chain/useGameChain";
import { auctionLotAction, auctionAction } from "@/lib/chain/gameFlows";
import Link from "next/link";
import { BarList, StatTile } from "@/components/ops";
import { useConfirm } from "@/components/useConfirm";
import { dangerCopy } from "@/lib/data/dangerous";
import { usd } from "@/lib/money";
import { auctionRules } from "@/lib/data/gameConfig";
import {
  readLots,
  ensureAuction,
  readAuctionMeta,
  setLotState,
  closeBidding,
  markReady,
  closeVoting,
  cancelAuction,
  newAuction,
  appendAuctionHistory,
  leaderboard,
  lotSum,
  auctionTotals,
  type AuctionLot,
  type AuctionMeta,
} from "@/lib/data/auction";
import type { Profile } from "@/lib/data/types";

function fmtLeft(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

// The streamer's control room for one auction, tab by state:
// bidding — private lots to accept or return, the public leaderboard, the bell and the kill switch;
// performing — the winning condition and the Done button;
// voting — the live tally (the community votes on the public page, the streamer only watches);
// settled/refunded/cancelled — the outcome and a fresh start.
// Shares lib/data/auction.ts with the public page, so both stay in step.
export function AuctionOverview({ profile, scope, shareQuery = "" }: { profile: Profile; scope?: string; shareQuery?: string }) {
  // scope = the session's storage key (defaults to the bare handle for pre-session data);
  // links and the history archive always use the real handle.
  const handle = scope ?? profile.handle;
  // Shared game state: pulls the server copy into localStorage; the 1s tick below re-reads it.
  useGameSync(handle);
  // Accepting, returning, closing and cancelling all move other people's money and can't be undone.
  const confirm = useConfirm();
  // A hook — must run every render in the same order, so it lives ABOVE the `if (!meta) return null`
  // early return below (calling it after that return changed the hook order the moment a round
  // loaded, which React treats as a crash).
  const chain = useGameChain("auction");
  // This auction's rules — the ones the session was opened with, not whatever the profile says today.
  const cfg = auctionRules(profile, handle);

  const [lots, setLots] = useState<AuctionLot[]>([]);
  const [meta, setMeta] = useState<AuctionMeta | null>(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    setLots(readLots(handle));
    setMeta(ensureAuction(handle));
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [handle]);

  // Keep up with lots and votes landing from the public page.
  useEffect(() => {
    if (!now) return;
    setLots(readLots(handle));
    const m = readAuctionMeta(handle);
    if (m) setMeta(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now]);

  // Derived up here, BEFORE any early return: the effect below is a hook, so it has to run on
  // every render in the same order — parking it after `if (!meta) return null` made the hook
  // order change the moment a round loaded, which React treats as a crash.
  const state = meta?.state;
  const msLeft = meta ? meta.startedAt + cfg.biddingHours * 3_600_000 - now : 1;

  // The bidding clock ran out — ring the bell exactly as the "Close bidding" button would.
  useEffect(() => {
    if (!now || state !== "bidding" || msLeft > 0) return;
    setMeta(closeBidding(handle));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, state]);

  if (!meta) return null;

  const totals = auctionTotals(lots);
  const board = leaderboard(lots);
  const pending = lots.filter((l) => l.state === "pending");
  const winner = meta.winnerId ? lots.find((l) => l.id === meta.winnerId) ?? null : null;

  function record(verdict: "paid out" | "refunded" | "cancelled", m: AuctionMeta) {
    const w = m.winnerId ? readLots(handle).find((l) => l.id === m.winnerId) : null;
    appendAuctionHistory(profile.handle, {
      id: `a-${m.startedAt}`,
      date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      condition: w ? w.text : "No accepted lots — nothing to win.",
      pot: w ? lotSum(w) : 0,
      lots: leaderboard(readLots(handle)).length,
      verdict,
    });
  }

  function onCloseBidding() {
    const m = closeBidding(handle);
    setMeta(m);
    if (m.state === "cancelled") record("cancelled", m);
  }

  // On-chain twins of the streamer's calls — only for canister-born auctions/lots.
  function chainLot(l: { chainLot?: string } | undefined, action: "accept" | "return-lot") {
    if (!l?.chainLot || !meta?.chainAuction || !chain.live || !chain.wallet) return;
    void auctionLotAction(chain.wallet, meta.chainAuction, l.chainLot, action);
  }

  function onCancel() {
    if (meta?.chainAuction && chain.live && chain.wallet) void auctionAction(chain.wallet, meta.chainAuction, "cancel");
    const m = cancelAuction(handle);
    setMeta(m);
    record("cancelled", m);
  }

  function onCountVotes() {
    const m = closeVoting(handle);
    setMeta(m);
    record(m.state === "settled" ? "paid out" : "refunded", m);
  }

  function onNewAuction() {
    setMeta(newAuction(handle));
    setLots(readLots(handle));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* ---- BIDDING ---- */}
      {state === "bidding" && (
        <>
          {pending.length > 0 && (
            <div className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <h2 style={{ fontSize: 16 }}>New lots — only you can read these</h2>
              <div className="footnote">
                Accept a lot and its text goes public into the bidding. Turn it down and the money goes straight back.
              </div>
              {pending.map((l) => (
                <div key={l.id} className="panel" style={{ display: "flex", flexDirection: "column", gap: 10, padding: 14 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                    <b className="num" style={{ fontSize: 20 }}>{usd(lotSum(l))}</b>
                    <span style={{ color: "var(--text-2)", fontSize: 14 }}>from {l.from}</span>
                    <span style={{ marginLeft: "auto", color: "var(--text-3)", fontSize: 13 }}>{l.when}</span>
                  </div>
                  <div style={{ fontSize: 15 }}>“{l.text}”</div>
                  <div style={{ display: "flex", gap: 10 }}>
                    <button
                      className="btn"
                      type="button"
                      onClick={() =>
                        confirm(dangerCopy.acceptLot(lotSum(l)), () => {
                          chainLot(l, "accept");
                          setLots(setLotState(handle, l.id, "accepted"));
                        })
                      }
                    >
                      Accept
                    </button>
                    <button
                      className="btn-outline"
                      type="button"
                      onClick={() =>
                        confirm(dangerCopy.returnLot(lotSum(l)), () => {
                          chainLot(l, "return-lot");
                          setLots(setLotState(handle, l.id, "returned"));
                        })
                      }
                    >
                      Turn down
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="card" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div className="footnote">
              Viewers bid conditions with money — the richest lot you&apos;ve accepted wins your time when the clock runs out.
            </div>

            {board.length === 0 ? (
              <div className="empty-log">
                No accepted lots yet — viewers place them on your{" "}
                <Link href={`/@${profile.handle}/auction${shareQuery}`} target="_blank" style={{ color: "var(--accent)" }}>
                  auction page
                </Link>
                {pending.length > 0 ? ", and some are waiting on your decision above." : "."}
              </div>
            ) : (
              <>
                <div className="stat-grid">
                  <StatTile k="Leading lot" v={usd(totals.top ? lotSum(totals.top) : 0)} />
                  <StatTile k="Bell in" v={fmtLeft(msLeft)} />
                  <StatTile k="Lots in play" v={String(board.length)} />
                </div>
                <BarList
                  unit="money"
                  bars={board.map((l) => ({
                    label: `“${l.text.length > 48 ? l.text.slice(0, 48) + "…" : l.text}” · ${l.entries.length} backer${l.entries.length > 1 ? "s" : ""}`,
                    value: lotSum(l),
                    display: usd(lotSum(l)),
                  }))}
                />
              </>
            )}

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                className="btn"
                type="button"
                disabled={board.length === 0}
                onClick={() => confirm(dangerCopy.closeBidding(totals.top ? lotSum(totals.top) : 0), onCloseBidding)}
              >
                Close the bidding now
              </button>
              <button
                className="btn-outline"
                type="button"
                onClick={() => confirm(dangerCopy.cancelAuction(totals.pot), onCancel, { danger: true })}
              >
                Cancel the auction
              </button>
            </div>
            <div className="footnote">
              The bell also rings on its own when the clock runs out. Losers are refunded on the spot — only the winner waits
              on your delivery. Cancelling refunds every lot.
            </div>
          </div>
        </>
      )}

      {/* ---- PERFORMING ---- */}
      {state === "performing" && winner && (
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span className="pill ok">
              <span className="dot" />
              Winning lot
            </span>
            <b className="num" style={{ fontSize: 22 }}>{usd(lotSum(winner))}</b>
            <span style={{ color: "var(--text-2)" }}>
              · {winner.entries.length} backer{winner.entries.length > 1 ? "s" : ""} · every other lot has been refunded
            </span>
          </div>
          <div style={{ fontSize: 17, lineHeight: 1.5 }}>“{winner.text}”</div>
          <div className="footnote">
            Deliver it within {cfg.performHours}h, then hit Done — your reputation holders take it from there. Miss the
            window and everyone is refunded.
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn" type="button" onClick={() => { if (meta?.chainAuction && chain.live && chain.wallet) void auctionAction(chain.wallet, meta.chainAuction, "ready"); setMeta(markReady(handle)); }}>
              Done — start the vote
            </button>
          </div>
        </div>
      )}

      {/* ---- VOTING ---- */}
      {state === "voting" && winner && (
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span className="pill wait">
              <span className="dot" />
              Voting
            </span>
            <span style={{ color: "var(--text-2)" }}>Your reputation holders are confirming: “{winner.text}”</span>
          </div>

          <div className="stat-grid">
            <StatTile k="Delivered" v={`${meta.votes.done}`} />
            <StatTile k="Not delivered" v={`${meta.votes.notDone}`} />
            <StatTile k="Voters" v={String(meta.votes.voters.length)} />
          </div>
          <div className="footnote">
            Weights are reputation with you. You don&apos;t vote — the community does, on your{" "}
            <Link href={`/@${profile.handle}/auction${shareQuery}`} target="_blank" style={{ color: "var(--accent)" }}>
              auction page
            </Link>
            . Strictly more “delivered” pays you out; a tie or silence refunds everyone.
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn" type="button" onClick={onCountVotes}>
              Count the votes
            </button>
          </div>
        </div>
      )}

      {/* ---- TERMINAL ---- */}
      {(state === "settled" || state === "refunded" || state === "cancelled") && (
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span className={`pill ${state === "settled" ? "ok" : "wait"}`}>
              <span className="dot" />
              {state === "settled" ? "Paid out" : state === "refunded" ? "Refunded" : "Cancelled"}
            </span>
            {winner && state === "settled" && (
              <span style={{ color: "var(--text-2)" }}>
                <b className="num">{usd(lotSum(winner))}</b> is yours — every backer of the lot earned reputation for their share.
              </span>
            )}
            {winner && state === "refunded" && (
              <span style={{ color: "var(--text-2)" }}>The vote didn&apos;t confirm delivery — all {usd(lotSum(winner))} went back.</span>
            )}
            {state === "cancelled" && <span style={{ color: "var(--text-2)" }}>Every lot was refunded in full.</span>}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn" type="button" onClick={onNewAuction}>
              Open a new auction
            </button>
          </div>
          <div className="footnote">A new auction clears the board and restarts the clock. This one is recorded in History.</div>
        </div>
      )}
      {confirm.dialog}
    </div>
  );
}
