"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useCrown } from "@/lib/data/DataProvider";
import { SOURCE_LABEL } from "@/lib/format";
import type { GameId } from "@/lib/data/games";
import type { Donation } from "@/lib/data/types";
import { SearchIcon, ChevronDown } from "@/components/icons";
import { Feed } from "./Feed";

type GameFilter = "all" | GameId | "direct";
type Sort = "new" | "old" | "top";
type Range = "all" | "1" | "7" | "30";

const GAME_OPTIONS: (GameId | "direct")[] = ["direct", "task", "roulette", "fundraiser", "auction"];
const RANGES: { key: Range; label: string }[] = [
  { key: "all", label: "All time" },
  { key: "1", label: "24h" },
  { key: "7", label: "7 days" },
  { key: "30", label: "30 days" },
];
const AMOUNTS: { key: number; label: string }[] = [
  { key: 0, label: "Any" },
  { key: 10, label: "$10+" },
  { key: 50, label: "$50+" },
  { key: 100, label: "$100+" },
];
const SORTS: { key: Sort; label: string }[] = [
  { key: "new", label: "Newest" },
  { key: "old", label: "Oldest" },
  { key: "top", label: "Top" },
];

// A donation's moment in ms — the on-chain block time if we have it, else the calendar day, else now.
function ts(d: Donation, now: number): number {
  if (d.at) return d.at;
  if (d.date) {
    const t = Date.parse(`${d.date}T00:00:00`);
    if (Number.isFinite(t)) return t;
  }
  return now;
}

function DownloadIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3v12M7 10l5 5 5-5M4 20h16" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
      <path d="M3 9h18M8 2.5v4M16 2.5v4" />
    </svg>
  );
}

function CoinIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M14.5 8.5c-.6-.7-1.5-1-2.5-1-1.7 0-2.8.9-2.8 2.1 0 2.9 5.6 1.4 5.6 4.3 0 1.2-1.1 2.1-2.8 2.1-1 0-1.9-.3-2.5-1M12 6v1.5M12 16.5V18" />
    </svg>
  );
}

// "2026-07-14" → "Jul 14" for the date-filter label.
function fmtShort(iso: string): string {
  const t = Date.parse(`${iso}T00:00:00`);
  return Number.isFinite(t) ? new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : iso;
}

// The cabinet's "Donations" tab: the full feed with rich filtering (name, mini-game, date range,
// amount floor, with-message), a sort, a live summary, and CSV export. All client-side over the
// same feed the rest of the cabinet reads.
export function DonationsPanel() {
  const { feed } = useCrown();
  const [query, setQuery] = useState("");
  const [game, setGame] = useState<GameFilter>("all");
  const [range, setRange] = useState<Range>("all");
  const [dateFrom, setDateFrom] = useState(""); // custom interval, YYYY-MM-DD; combines with the range chips
  const [dateTo, setDateTo] = useState("");
  const [minAmount, setMinAmount] = useState(0);
  const [withMsg, setWithMsg] = useState(false);
  const [merge, setMerge] = useState(false); // roll every donor's donations into one row (total + count)
  const [sort, setSort] = useState<Sort>("new");
  const [dateOpen, setDateOpen] = useState(false); // the date-filter dropdown (presets + custom range)
  const dateRef = useRef<HTMLDivElement>(null);
  const [amountOpen, setAmountOpen] = useState(false); // the amount-filter dropdown (presets + custom min)
  const amountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dateOpen) return;
    const onDown = (e: MouseEvent) => {
      if (dateRef.current && !dateRef.current.contains(e.target as Node)) setDateOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setDateOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [dateOpen]);

  useEffect(() => {
    if (!amountOpen) return;
    const onDown = (e: MouseEvent) => {
      if (amountRef.current && !amountRef.current.contains(e.target as Node)) setAmountOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setAmountOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [amountOpen]);

  const dateActive = range !== "all" || !!dateFrom || !!dateTo;
  const dateLabel = dateFrom || dateTo
    ? `${dateFrom ? fmtShort(dateFrom) : "…"} – ${dateTo ? fmtShort(dateTo) : "…"}`
    : range === "all"
    ? "Any date"
    : RANGES.find((r) => r.key === range)?.label ?? "Any date";

  const amountActive = minAmount > 0;
  const amountLabel = minAmount > 0 ? `$${minAmount}+` : "Any amount";

  const rows = useMemo(() => {
    const now = Date.now();
    const needle = query.trim().toLowerCase();
    const from = dateFrom ? Date.parse(`${dateFrom}T00:00:00`) : NaN;
    const to = dateTo ? Date.parse(`${dateTo}T23:59:59`) : NaN;
    const filtered = feed.filter((d) => {
      if (needle && !d.from.toLowerCase().includes(needle)) return false;
      if (game !== "all" && (d.source ?? "direct") !== game) return false;
      if (range !== "all" && (now - ts(d, now)) / 86_400_000 > Number(range)) return false;
      if (Number.isFinite(from) && ts(d, now) < from) return false;
      if (Number.isFinite(to) && ts(d, now) > to) return false;
      if (d.amount < minAmount) return false;
      if (withMsg && !d.message) return false;
      return true;
    });
    return filtered.sort((a, b) => {
      if (sort === "top") return b.amount - a.amount || ts(b, now) - ts(a, now);
      const d = ts(a, now) - ts(b, now);
      return sort === "old" ? d : -d;
    });
  }, [feed, query, game, range, dateFrom, dateTo, minAmount, withMsg, sort]);

  // "Merge by name": one row per donor, amounts summed, message replaced by the donation count.
  const displayRows = useMemo(() => {
    if (!merge) return rows;
    const now = Date.now();
    const byName = new Map<string, { d: Donation; total: number; count: number; latest: number }>();
    for (const d of rows) {
      const key = d.from.toLowerCase();
      const t = ts(d, now);
      const cur = byName.get(key);
      if (!cur) byName.set(key, { d, total: d.amount, count: 1, latest: t });
      else {
        cur.total += d.amount;
        cur.count += 1;
        if (t > cur.latest) { cur.d = d; cur.latest = t; } // keep the most recent one's name/time/date
      }
    }
    const merged: Donation[] = [...byName.values()].map(({ d, total, count }) => ({
      ...d,
      amount: total,
      message: count > 1 ? `${count} donations` : d.message,
      source: undefined, // a merged row spans sources — no single-source label
    }));
    return merged.sort((a, b) => {
      if (sort === "top") return b.amount - a.amount;
      const diff = ts(a, now) - ts(b, now);
      return sort === "old" ? diff : -diff;
    });
  }, [rows, merge, sort]);

  const activeCount =
    (query.trim() ? 1 : 0) + (game !== "all" ? 1 : 0) + (range !== "all" ? 1 : 0) + (dateFrom || dateTo ? 1 : 0) + (minAmount > 0 ? 1 : 0) + (withMsg ? 1 : 0);

  function clearAll() {
    setQuery("");
    setGame("all");
    setRange("all");
    setDateFrom("");
    setDateTo("");
    setMinAmount(0);
    setWithMsg(false);
  }

  function exportCsv() {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const head = ["Name", "Amount $", "Source", "Message", "Date", "When", "Tx"];
    const lines = rows.map((d) =>
      [d.from, String(d.amount), SOURCE_LABEL[d.source ?? "direct"], d.message ?? "", d.date ?? "", d.time, d.sig ?? ""]
        .map(esc)
        .join(",")
    );
    const csv = [head.map(esc).join(","), ...lines].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `crown-donations-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="don">
      {/* toolbar row 1: search · sort · export */}
      <div className="don-bar">
        <div className="don-search-wrap">
          <SearchIcon width={18} height={18} />
          <input
            className="don-search"
            type="search"
            placeholder="Search by name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search donations by name"
          />
        </div>
        <div className="seg" role="group" aria-label="Sort">
          {SORTS.map((s) => (
            <button key={s.key} type="button" className={sort === s.key ? "active" : ""} onClick={() => setSort(s.key)}>
              {s.label}
            </button>
          ))}
        </div>
        <button type="button" className="don-export" onClick={exportCsv} disabled={!rows.length} title="Download the filtered list as CSV">
          <DownloadIcon /> Export
        </button>
      </div>

      {/* toolbar row 2: filters — game · date · amount on the left, toggles to the right */}
      <div className="don-filters">
        <select className="don-select" value={game} onChange={(e) => setGame(e.target.value as GameFilter)} aria-label="Filter by mini-game">
          <option value="all">All games</option>
          {GAME_OPTIONS.map((g) => (
            <option key={g} value={g}>
              {SOURCE_LABEL[g]}
            </option>
          ))}
        </select>

        {/* One date control: quick presets + a custom interval, folded into a dropdown so the toolbar
            isn't two competing date filters side by side. */}
        <div className="don-drop" ref={dateRef}>
          <button
            type="button"
            className={`don-select don-drop-btn${dateActive ? " on" : ""}`}
            onClick={() => setDateOpen((o) => !o)}
            aria-expanded={dateOpen}
            aria-label="Filter by date"
          >
            <CalendarIcon />
            <span className="don-drop-val">{dateLabel}</span>
            <span className={`don-drop-chev${dateOpen ? " open" : ""}`}>
              <ChevronDown />
            </span>
          </button>
          {dateOpen && (
            <div className="don-drop-menu" role="dialog" aria-label="Date filter">
              <div className="don-drop-presets">
                {RANGES.map((r) => (
                  <button
                    key={r.key}
                    type="button"
                    className={`don-drop-opt${range === r.key && !dateFrom && !dateTo ? " sel" : ""}`}
                    onClick={() => {
                      setRange(r.key);
                      setDateFrom("");
                      setDateTo("");
                    }}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              <div className="don-drop-sep" />
              <div className="don-drop-custom">
                <span className="don-drop-label">Custom range</span>
                <div className="don-daterange">
                  <input
                    className="don-date"
                    type="date"
                    value={dateFrom}
                    max={dateTo || undefined}
                    onChange={(e) => {
                      setDateFrom(e.target.value);
                      setRange("all");
                    }}
                    aria-label="From date"
                  />
                  <span className="dash">–</span>
                  <input
                    className="don-date"
                    type="date"
                    value={dateTo}
                    min={dateFrom || undefined}
                    onChange={(e) => {
                      setDateTo(e.target.value);
                      setRange("all");
                    }}
                    aria-label="To date"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Amount filter — same dropdown shape as the date one: preset floors + a "Custom amount" min
            below, so you can filter by any threshold, not just the round presets. */}
        <div className="don-drop" ref={amountRef}>
          <button
            type="button"
            className={`don-select don-drop-btn${amountActive ? " on" : ""}`}
            onClick={() => setAmountOpen((o) => !o)}
            aria-expanded={amountOpen}
            aria-label="Filter by amount"
          >
            <CoinIcon />
            <span className="don-drop-val">{amountLabel}</span>
            <span className={`don-drop-chev${amountOpen ? " open" : ""}`}>
              <ChevronDown />
            </span>
          </button>
          {amountOpen && (
            <div className="don-drop-menu" role="dialog" aria-label="Amount filter">
              <div className="don-drop-presets">
                {AMOUNTS.map((a) => (
                  <button
                    key={a.key}
                    type="button"
                    className={`don-drop-opt${minAmount === a.key ? " sel" : ""}`}
                    onClick={() => setMinAmount(a.key)}
                  >
                    {a.key === 0 ? "Any amount" : a.label}
                  </button>
                ))}
              </div>
              <div className="don-drop-sep" />
              <div className="don-drop-custom">
                <span className="don-drop-label">Custom amount</span>
                <div className="don-affix">
                  <span className="don-affix-pre">$</span>
                  <input
                    className="don-amount"
                    type="number"
                    min={0}
                    inputMode="numeric"
                    placeholder="Min"
                    value={minAmount > 0 && !AMOUNTS.some((a) => a.key === minAmount) ? minAmount : ""}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      setMinAmount(Number.isFinite(n) && n > 0 ? n : 0);
                    }}
                    aria-label="Minimum amount in dollars"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="don-toggles">
          <label className={`toggle${withMsg ? " on" : ""}`}>
            <span className="track">
              <span className="knob" />
            </span>
            <input type="checkbox" hidden checked={withMsg} onChange={(e) => setWithMsg(e.target.checked)} />
            With message
          </label>

          <label className={`toggle${merge ? " on" : ""}`}>
            <span className="track">
              <span className="knob" />
            </span>
            <input type="checkbox" hidden checked={merge} onChange={(e) => setMerge(e.target.checked)} />
            Merge by name
          </label>
        </div>
      </div>

      {/* results line + clear */}
      <div className="don-resultline">
        <span>
          {displayRows.length} {merge ? (displayRows.length === 1 ? "donor" : "donors") : displayRows.length === 1 ? "donation" : "donations"}
        </span>
        {activeCount > 0 && (
          <button type="button" className="don-clear" onClick={clearAll}>
            Clear {activeCount} {activeCount === 1 ? "filter" : "filters"}
          </button>
        )}
      </div>

      {displayRows.length === 0 ? (
        <div className="empty-log">No donations match these filters.</div>
      ) : (
        <Feed rows={displayRows} detailed showHead={false} />
      )}
    </div>
  );
}
