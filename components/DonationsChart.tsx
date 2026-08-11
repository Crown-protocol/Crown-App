"use client";

import { useMemo, useState } from "react";
import { Chart } from "@/components/Chart";
import { GameIcon, NavIcon } from "@/components/icons";
import { money } from "@/components/ops";
import { DONATION_SOURCES, splitByGame, type DashboardPeriod, type DashboardPeriodKey, type DonationSource } from "@/lib/data/mock";

const SOURCE_LABEL: Record<DonationSource, string> = {
  direct: "Regular",
  task: "Task",
  roulette: "Roulette",
  fundraiser: "Fundraiser",
  auction: "Auction",
};

// "Donations by day", filterable by source right on the chart (like the admin panel's growth
// chart): pick one game, a few, or all, and the headline number is what those made over the
// period chosen at the top of Home. Replaces the old static "Donations by game" bar list.
export function DonationsChart({ d, periodLabel, period }: { d: DashboardPeriod; periodLabel: string; period: DashboardPeriodKey }) {
  const [selected, setSelected] = useState<Set<DonationSource>>(new Set(DONATION_SOURCES));
  const split = useMemo(() => splitByGame(d), [d]);
  const allOn = selected.size === DONATION_SOURCES.length;

  // The charted series is the per-day sum of whatever sources are selected.
  const series = useMemo(
    () => d.days.map((_, i) => DONATION_SOURCES.reduce((sum, k) => sum + (selected.has(k) ? split[k][i] : 0), 0)),
    [split, selected, d.days],
  );
  const earned = series.reduce((a, b) => a + b, 0);
  const peakValue = series.length ? Math.max(...series) : 0;
  const peakIndex = series.indexOf(peakValue);
  const peakLabel = peakIndex >= 0 && d.labels?.[peakIndex] ? `${d.labels[peakIndex]} · ${money(peakValue)}` : money(peakValue);

  // Click a game when everything's on → isolate it; otherwise toggle it in/out (never below one).
  function toggle(k: DonationSource) {
    setSelected((prev) => {
      if (prev.size === DONATION_SOURCES.length) return new Set([k]);
      const next = new Set(prev);
      if (next.has(k)) {
        if (next.size === 1) return next;
        next.delete(k);
      } else {
        next.add(k);
      }
      return next;
    });
  }

  const selectionLabel = allOn ? "All sources" : selected.size === 1 ? SOURCE_LABEL[[...selected][0]] : `${selected.size} sources`;

  const controls = (
    <>
      <div className="growth-picker">
        <button type="button" className={`chip${allOn ? " active" : ""}`} onClick={() => setSelected(new Set(DONATION_SOURCES))}>
          All
        </button>
        {DONATION_SOURCES.map((k) => (
          <button key={k} type="button" className={`chip${selected.has(k) && !allOn ? " active" : ""}`} onClick={() => toggle(k)}>
            {k === "direct" ? <NavIcon name="donations" /> : <GameIcon id={k} width={16} height={16} />}
            {SOURCE_LABEL[k]}
          </button>
        ))}
      </div>
      <div className="gv num">{money(earned)}</div>
      <div className="footnote">
        {selectionLabel} · {periodLabel}
      </div>
    </>
  );

  return (
    <Chart
      // "All time" buckets by MONTH (12 of them, dashboard.ts), 7/30 days bucket by day — so the
      // title has to follow the period instead of always claiming days. A chart whose bars are
      // months under a heading that says "by day" is simply telling the maker the wrong thing.
      title={period === "all" ? "Donations by month" : "Donations by day"}
      days={series}
      peakValue={peakValue}
      peakLabel={peakLabel}
      axis={d.axis}
      labels={d.labels}
      controls={controls}
    />
  );
}
