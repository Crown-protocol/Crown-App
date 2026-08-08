// Real dashboard numbers, computed from the maker's own donations — the honest replacement for the
// hard-coded MOCK_DASHBOARD sample. The cabinet's Home tab used to show "$1,284 received, 96 donations"
// to a brand-new page with zero real money; that's a lie about money, so by default the tiles and the
// chart are built from the actual feed here. MOCK_DASHBOARD still exists, but it's opt-in now: the
// admin panel's "Demo dashboard numbers" switch turns it on for screenshots/demos, and when it's on
// the cabinet paints those numbers red with a "demo" tooltip so nobody mistakes them for real.

import type { Donation } from "./types";
import { isDemoAddress } from "./session";
import { usd } from "@/lib/money";
import { DONATION_SOURCES, type DashboardPeriod, type DashboardPeriodKey, type ByGameRow, type DonationSource } from "./mock";

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
// Rows with no `streamer` are the demo seed (MOCK_FEED, the DataProvider's initial state) plus
// locally-recorded mock donations. They used to count as "mine" unconditionally, which meant a brand
// new page opened its dashboard on someone else's $219 — the one number a maker must be able to
// trust. Now they only count for a page that has no real payout address yet (the demo cabinet, where
// they ARE the point); a real address sees its own money and nothing else.
function mine(donations: Donation[], address: string | undefined): Donation[] {
  if (!address || isDemoAddress(address)) return donations.filter((d) => !d.streamer);
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

  return { received, donations, newViewers, peakLabel, days, labels, peakValue, axis, byGame };
}
