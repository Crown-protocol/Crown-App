// The cabinet's numbers, computed from the maker's own donations. There is no
// sample dataset behind this any more: the Home tab used to be able to show
// "$1,284 received" to a page that had earned nothing, and a lie about money is
// the one thing a dashboard must never be capable of.
//
// The shapes live here too, next to the only thing that builds them.

import type { Donation } from "./types";
import type { GameId } from "./games";
import { usd } from "@/lib/money";

export type DashboardPeriodKey = "7" | "30" | "all";

// "direct" is a donation with no game behind it; the rest are the mini-games.
export type DonationSource = GameId | "direct";
export const DONATION_SOURCES: DonationSource[] = ["direct", "task", "roulette", "fundraiser"];

export interface ByGameRow {
  id: DonationSource;
  amount: number;
}

export interface DashboardPeriod {
  received: number;
  donations: number;
  newViewers: number;
  peakLabel: string;
  days: number[]; // chart points for the period (days, or for "all", months)
  labels: string[]; // one label per point in `days`
  peakValue: number;
  axis: string[]; // 3 axis labels
  byGame: ByGameRow[];
  // Per-source daily series — counted from the donations themselves. It used to
  // be SYNTHESIZED from the totals by a sine-weighted split, so the "by game"
  // curves on the cabinet chart were a plausible-looking shape rather than what
  // each game earned.
  series: Record<DonationSource, number[]>;
}

const DAY_MS = 86_400_000;
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// The millisecond clock for a donation: the on-chain settle time when we have it, else the calendar
// day it was tagged with, else "now" (a just-recorded local/mock row). Kept lenient so a feed that
// mixes real indexer rows and freshly-published local ones still buckets sanely.
function whenMs(d: Donation): number {
  if (typeof d.at === "number") return d.at;
  if (d.date) {
    const t = Date.parse(`${d.date}T12:00:00Z`);
    if (!Number.isNaN(t)) return t;
  }
  return Date.now();
}

function source(d: Donation): DonationSource {
  return d.source && DONATION_SOURCES.includes(d.source as DonationSource) ? (d.source as DonationSource) : "direct";
}

// Money this maker actually received. The feed is one global stream, so filter to donations sent to
// THIS payout address.
//
// A page with no payout address has earned nothing by definition — it cannot have
// been paid. Every row now carries the recipient it was mirrored from, so "mine"
// is an exact match and never a fallback.
function mine(donations: Donation[], address: string | undefined): Donation[] {
  if (!address) return [];
  return donations.filter((d) => d.streamer === address);
}

interface Bucket {
  start: number; // inclusive ms
  end: number; // exclusive ms
  label: string;
}

// The time buckets for a period: 7 or 30 days back (one per day), or 12 months back (one per month
// for "all"). Anchored to now so the rightmost bucket is today / this month.
function buckets(period: DashboardPeriodKey, now: number): Bucket[] {
  if (period === "all") {
    const out: Bucket[] = [];
    const d = new Date(now);
    // Walk back 11 months from the current month, so we end with 12 buckets ending in this month.
    let y = d.getUTCFullYear();
    let m = d.getUTCMonth() - 11;
    while (m < 0) {
      m += 12;
      y -= 1;
    }
    for (let i = 0; i < 12; i++) {
      const start = Date.UTC(y, m, 1);
      const end = Date.UTC(m === 11 ? y + 1 : y, m === 11 ? 0 : m + 1, 1);
      out.push({ start, end, label: `${MONTH[m]} ${y}` });
      m += 1;
      if (m > 11) {
        m = 0;
        y += 1;
      }
    }
    return out;
  }

  const n = period === "7" ? 7 : 30;
  const out: Bucket[] = [];
  // Midnight (UTC) of today, then step back day by day. UTC keeps buckets stable regardless of the
  // viewer's timezone — the same donation never hops between two days across two machines.
  const today = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
  for (let i = n - 1; i >= 0; i--) {
    const start = today - i * DAY_MS;
    const dd = new Date(start);
    out.push({ start, end: start + DAY_MS, label: `${MONTH[dd.getUTCMonth()]} ${dd.getUTCDate()}` });
  }
  return out;
}

// Build a real DashboardPeriod from the maker's donations. Empty feed → all zeros and a flat chart,
// which is the truth for a page that hasn't earned anything yet (never the mock's invented $1,284).
export function buildDashboard(all: Donation[], period: DashboardPeriodKey, address: string | undefined, now = Date.now()): DashboardPeriod {
  const rows = mine(all, address);
  const bs = buckets(period, now);
  const from = bs[0].start;
  const to = bs[bs.length - 1].end;
  const inRange = rows.filter((d) => {
    const t = whenMs(d);
    return t >= from && t < to;
  });

  const days = bs.map((b) => inRange.filter((d) => whenMs(d) >= b.start && whenMs(d) < b.end).reduce((s, d) => s + d.amount, 0));
  const labels = bs.map((b) => b.label);

  const received = inRange.reduce((s, d) => s + d.amount, 0);
  const donations = inRange.length;

  // "New viewers" = distinct donors whose FIRST donation to this maker (across the whole feed, not
  // just the window) lands inside the window. A donor who gave before the period isn't "new" now.
  //
  // Identity is the payer wallet, else the donor name. A row with NEITHER is a truly anonymous
  // donation — it can't be de-duplicated against any other, so each one is its own distinct viewer.
  // Collapsing them all under a single `undefined` key (the old bug) counted a hundred anonymous
  // donors as one. We give each such row a unique key instead.
  const firstSeen = new Map<string, number>();
  let anon = 0;
  for (const d of rows) {
    const who = d.payer ?? d.from ?? `__anon:${anon++}`;
    const t = whenMs(d);
    const prev = firstSeen.get(who);
    if (prev === undefined || t < prev) firstSeen.set(who, t);
  }
  let newViewers = 0;
  for (const t of firstSeen.values()) if (t >= from && t < to) newViewers += 1;

  // Peak bucket for the chart's highlight.
  let peakValue = 0;
  let peakIndex = 0;
  days.forEach((v, i) => {
    if (v > peakValue) {
      peakValue = v;
      peakIndex = i;
    }
  });
  const peakLabel = `${labels[peakIndex] ?? ""} · ${usd(peakValue)}`;

  // 3 axis ticks: first, middle, last label.
  const axis = labels.length ? [labels[0], labels[Math.floor((labels.length - 1) / 2)], labels[labels.length - 1]] : [];

  // Per-source totals in the window, in the fixed source order, dropping zeros so the chart's source
  // chips only show sources that actually earned something.
  const byMap = new Map<DonationSource, number>();
  for (const d of inRange) byMap.set(source(d), (byMap.get(source(d)) ?? 0) + d.amount);
  const byGame: ByGameRow[] = DONATION_SOURCES.map((id) => ({ id, amount: byMap.get(id) ?? 0 })).filter((r) => r.amount > 0);

  // The same buckets, split by where the money came from — measured, not modelled.
  const series = Object.fromEntries(
    DONATION_SOURCES.map((k) => [
      k,
      bs.map((b) =>
        inRange
          .filter((d) => source(d) === k && whenMs(d) >= b.start && whenMs(d) < b.end)
          .reduce((s, d) => s + d.amount, 0)
      ),
    ])
  ) as Record<DonationSource, number[]>;

  return { received, donations, newViewers, peakLabel, days, labels, peakValue, axis, byGame, series };
}
