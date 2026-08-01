"use client";

import Link from "next/link";
import { useCrown } from "@/lib/data/DataProvider";
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
  showSource = false,
  detailed = false,
  showHead = true,
}: {
  title?: string;
  limit?: number;
  moreHref?: string;
  onMore?: () => void; // in the cabinet, "Donations" is a tab (state), not a route — use a callback
  rows?: Donation[]; // override the context feed (e.g. a filtered list); falls back to the full feed
  showSource?: boolean; // show which mini-game each donation came through
  detailed?: boolean; // the Donations tab: source icon, reputation earned, exact time, explorer link
  showHead?: boolean;
}) {
  const { feed } = useCrown();
  const base = override ?? feed;
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
          return (
            <div className={`feed-row${detailed ? " feed-row-detail" : ""}${d.fresh ? " fresh" : ""}`} key={d.id}>
              <Mono name={d.from} size={40} />
              <span className="feed-name">{d.from}</span>
              <span className="feed-sum num">{usd(d.amount)}</span>
              {d.message ? <span className="feed-msg">{d.message}</span> : null}
              {detailed ? (
                <div className="feed-detail">
                  <span className="feed-src-tag">
                    {src === "direct" ? <NavIcon name="donations" /> : <GameIcon id={src} width={14} height={14} />}
                    {SOURCE_LABEL[src]}
                  </span>
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
