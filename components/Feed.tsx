"use client";

import Link from "next/link";
import { useCheer } from "@/lib/data/DataProvider";
import type { Donation } from "@/lib/data/types";
import { formatFeedDate, SOURCE_LABEL } from "@/lib/format";
import { usd } from "@/lib/money";
import { Mono } from "./Mono";
import { GameIcon, NavIcon } from "./icons";

export function Feed({
  title = "Donations",
  limit,
  moreHref,
  onMore,
  rows: override,
  forAddress,
  showSource = false,
  detailed = false,
  compact = false,
  showHead = true,
}: {
  title?: string;
  limit?: number;
  moreHref?: string;
  onMore?: () => void; // in the cabinet, "Donations" is a tab (state), not a route — use a callback
  rows?: Donation[]; // override the context feed (e.g. a filtered list); falls back to the full feed
  forAddress?: string; // show only money sent TO this payout address — see below
  showSource?: boolean; // show which mini-game each donation came through
  detailed?: boolean; // the Donations tab: source icon, reputation earned, exact time, explorer link
  // Strip a row back to who / how much / when — no message, no mini-game, no reputation. The cabinet's
  // "Details" switch drives this; public feeds never set it, so their messages always show.
  compact?: boolean;
  showHead?: boolean;
}) {
  const { feed } = useCheer();
  // The chain feed is one global stream of every Settled event, so a maker's page must narrow it to
  // its own payout address — otherwise "Recent supporters" lists strangers' donations to strangers.
  // Mock rows carry no `streamer`, and there the whole feed already belongs to the page being shown.
  const base = override ?? (forAddress ? feed.filter((d) => !d.streamer || d.streamer === forAddress) : feed);
  const rows = limit ? base.slice(0, limit) : base;

  return (
    <div>
      {showHead ? (
        <div className="feed-head">
          <h2>{title}</h2>
          {onMore ? (
            <button type="button" className="more" onClick={onMore}>
              All donations →
            </button>
          ) : moreHref ? (
            <Link className="more" href={moreHref}>
              All donations →
            </Link>
          ) : null}
        </div>
      ) : null}
      <div className="feed">
        {rows.map((d) => {
          const src = d.source ?? "direct";
          const rep = Math.max(0, Math.floor(d.amount)); // $1 donated = 1 reputation (front.md I §4)
          const exact = d.at ? new Date(d.at) : null;
          const clock = exact ? `${String(exact.getHours()).padStart(2, "0")}:${String(exact.getMinutes()).padStart(2, "0")}` : null;
          // Money still in flight: the donor submitted, the chain hasn't confirmed yet. The amount
          // is genuinely unknown until it does — the intent records who and what, not how much — so
          // show a dash instead of a number nobody can stand behind.
          const sending = d.status === "sending";
          return (
            <div
              className={`feed-row${detailed ? " feed-row-detail" : ""}${d.fresh ? " fresh" : ""}${sending ? " feed-row-sending" : ""}`}
              key={d.id}
            >
              <Mono name={d.from} size={40} />
              <span className="feed-name">{d.from}</span>
              <span className="feed-sum num">
                {sending ? "—" : usd(d.amount)}
                {/* Merged rows (the cabinet's "Merge by name") say how many donations the total folds
                    in. It rides beside the money, not over the message — the donor's words stay. */}
                {d.mergedCount ? <span className="feed-count">×{d.mergedCount}</span> : null}
              </span>
              {/* The message is part of a row's DETAIL, not its identity, so the cabinet's "Details"
                  switch takes it down with everything else. Only that switch sets `compact`; public
                  feeds leave it off and keep showing messages exactly as before. */}
              {d.message && !compact ? <span className="feed-msg">{d.message}</span> : null}
              {detailed ? (
                <div className="feed-detail">
                  <span className="feed-src-tag">
                    {src === "direct" ? <NavIcon name="donations" /> : <GameIcon id={src} width={14} height={14} />}
                    {SOURCE_LABEL[src]}
                  </span>
                  {sending ? (
                    <span className="feed-status" title="Sent — waiting for the network to confirm it">
                      <span className="feed-status-dot" />
                      sending
                    </span>
                  ) : null}
                  {rep > 0 ? <span className="feed-rep num">+{rep} rep</span> : null}
                  {d.sig ? (
                    <a
                      className="feed-tx"
                      href={`https://explorer.solana.com/tx/${d.sig}?cluster=devnet`}
                      target="_blank"
                      rel="noreferrer"
                      title="View this donation on the Solana explorer"
                    >
                      tx ↗
                    </a>
                  ) : null}
                </div>
              ) : showSource ? (
                <span className="feed-src">{SOURCE_LABEL[src]}</span>
              ) : null}
              <span className="feed-time">
                {d.date ? formatFeedDate(d.date) : d.time}
                {clock ? (
                  <span className="feed-ago">
                    {clock} · {d.time}
                  </span>
                ) : d.date && d.time ? (
                  <span className="feed-ago">{d.time}</span>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
