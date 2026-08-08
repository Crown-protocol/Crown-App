"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { SocialIcon, GameIcon, NavIcon, SearchIcon } from "@/components/icons";
import { CheerBadge } from "@/components/CheerBadge";
import { LaunchReadiness } from "@/components/LaunchReadiness";
import { BotPanel } from "@/components/admin/BotPanel";
import { BarsIcon, LineIcon } from "@/components/Chart";
import { StatTile, BarList, GrowthChart, StatusPill, SortHeader, money, shortMoney, axisTicks } from "@/components/ops";
import { useCheer } from "@/lib/data/DataProvider";
import { useConfirm } from "@/components/useConfirm";
import { dangerCopy } from "@/lib/data/dangerous";
import { GAMES, type GameId } from "@/lib/data/games";
import {
  OPS_STATS, OPS_GROWTH, OPS_GROWTH_BY_PLATFORM, OPS_GROWTH_BY_GAME, OPS_BY_PLATFORM, OPS_BY_SIZE, OPS_GAME_ADOPTION,
  OPS_TASK_STATUS, OPS_STREAMERS, OPS_TASKS, OPS_DONATORS, TASK_STATUS_META, PENALTY_LADDER, APPLY_ACTIONS,
  type TaskStatus,
} from "@/lib/data/ops-mock";

// Local: the shared NavIcon no longer has a "people" case (space/page.tsx dropped it).
// Kept here instead of re-widening the shared component's type for one admin-only glyph.
function PeopleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.8 19c0-2.9 2.3-5.2 5.2-5.2s5.2 2.3 5.2 5.2" />
      <path d="M15.4 5.2a3.2 3.2 0 0 1 0 5.6" />
      <path d="M16.6 13.9c2.1.6 3.6 2.7 3.6 5.1" />
    </svg>
  );
}

// A single donor — the counterpart to PeopleIcon (a crowd) above. Content makers and Donators used
// to share one glyph, which made two different sections look like the same one.
function DonorIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5.5 19.5c0-3.3 2.9-5.9 6.5-5.9s6.5 2.6 6.5 5.9" />
    </svg>
  );
}

// Launch readiness: a checklist. It shared the settings glyph with Moderation, so the sidebar showed
// the same icon twice for two unrelated screens.
function ChecklistIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m4 7 2 2 3.5-3.5" />
      <path d="m4 16 2 2 3.5-3.5" />
      <path d="M13 7.5h7" />
      <path d="M13 16.5h7" />
    </svg>
  );
}

// Moderation: a shield — "we check things here", distinct from Settings' sliders.
function ShieldIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3.5 5 6.3v5.2c0 4 2.9 7.6 7 9 4.1-1.4 7-5 7-9V6.3L12 3.5Z" />
      <path d="m9.2 12 2 2 3.6-3.8" />
    </svg>
  );
}

type Section = "overview" | "streamers" | "donators" | "tasks" | "bot" | "launch" | "moderation" | "settings";
const NAV: { key: Section; label: string; icon: () => React.JSX.Element }[] = [
  { key: "overview", label: "Overview", icon: () => <NavIcon name="home" /> },
  { key: "streamers", label: "Content makers", icon: PeopleIcon },
  { key: "donators", label: "Donators", icon: DonorIcon },
  { key: "tasks", label: "Tasks", icon: () => <NavIcon name="games" /> },
  { key: "bot", label: "Telegram bot", icon: () => <NavIcon name="telegram" /> },
  { key: "launch", label: "Launch readiness", icon: ChecklistIcon },
];
const RANGES = [
  { key: "1d", label: "1D", n: 2 },
  { key: "1w", label: "1W", n: 7 },
  { key: "1m", label: "1M", n: 14 },
  { key: "all", label: "All", n: 999 },
];

export default function OpsPage() {
  const [section, setSection] = useState<Section>("overview");

  return (
    <main className="admin-page">
      <nav className="admin-nav" aria-label="Admin panel sections">
        <div className="brand">
          <Link className="logo" href="/" aria-label="Go to homepage">
            <CheerBadge size={26} />
            Cheer
          </Link>
        </div>
        <div className="brand brand-tag" style={{ paddingTop: 0 }}>
        </div>
        {NAV.map((n) => (
          <button key={n.key} type="button" className={`admin-item${section === n.key ? " active" : ""}`} onClick={() => setSection(n.key)}>
            <n.icon />
            {n.label}
          </button>
        ))}
        <div className="admin-divider" />
        <button type="button" className={`admin-item${section === "moderation" ? " active" : ""}`} onClick={() => setSection("moderation")}>
          <ShieldIcon />
          Moderation
        </button>
        <div className="admin-divider" />
        <button type="button" className={`admin-item${section === "settings" ? " active" : ""}`} onClick={() => setSection("settings")}>
          <NavIcon name="settings" />
          Settings
        </button>
      </nav>

      {/* key on the section: React remounts the column when you switch, so the entrance
          cascade (globals.css .admin-main > *) replays for the newly shown content */}
      <div className="admin-main" key={section}>
        {section === "overview" && <Overview />}
        {section === "streamers" && <Streamers />}
        {section === "donators" && <Donators />}
        {section === "tasks" && <Tasks />}
        {section === "bot" && <BotPanel />}
        {section === "launch" && <LaunchReadiness />}
        {section === "moderation" && <Moderation />}
        {section === "settings" && <Settings />}
      </div>
    </main>
  );
}

const METRICS = [
  { key: "gross", label: "Overall" },
  { key: "net", label: "Net profit" },
  { key: "platform", label: "By platform" },
  { key: "game", label: "By games" },
] as const;
type Metric = (typeof METRICS)[number]["key"];

function Overview() {
  const [range, setRange] = useState("all");
  const [metric, setMetric] = useState<Metric>("gross");
  const [platform, setPlatform] = useState(OPS_BY_PLATFORM[0].kind);
  const [game, setGame] = useState<GameId>(GAMES[0].id);
  const [view, setView] = useState<"bars" | "line">("bars");
  const n = RANGES.find((r) => r.key === range)?.n ?? 999;
  const dates = OPS_GROWTH.dates.slice(-n);
  const gross = OPS_GROWTH.received.slice(-n);
  const rec =
    metric === "gross" ? gross
    : metric === "net" ? gross.map((v) => v * 0.03) // platform's 3% fee on every donation
    : metric === "platform" ? OPS_GROWTH_BY_PLATFORM[platform].slice(-n)
    : OPS_GROWTH_BY_GAME[game].slice(-n);
  const s = OPS_STATS;

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Overview</h1>
          <div className="sub">The whole platform, across all content makers.</div>
        </div>
      </div>

      <div className="stat-grid">
        <StatTile k="Content makers" v={String(s.streamers)} s={`${s.streamersActive} active · ${s.streamersLive} live`} />
        <StatTile k="Total received" v={money(s.received)} />
        <StatTile k="Last 7 days" v={money(s.last7d)} />
        <StatTile k="Fee" v={money(s.fee)} s="3% of volume" />
        <StatTile k="Average per content maker" v={money(s.avgPerStreamer)} />
        <StatTile k="Largest" v={money(s.largest)} />
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>Growth</h2>
            <div className="ph-sub">Cumulative · before launch — 0</div>
          </div>
        </div>

        <div className="growth-controls">
          <div className="seg" role="group" aria-label="Metric">
            {METRICS.map((m) => (
              <button key={m.key} type="button" className={metric === m.key ? "active" : ""} onClick={() => setMetric(m.key)}>
                {m.label}
              </button>
            ))}
          </div>
          <div className="right">
            <div className="seg" role="group" aria-label="Chart type">
              <button
                type="button"
                className={view === "bars" ? "active" : ""}
                onClick={() => setView("bars")}
                aria-label="Bars"
                title="Bars"
                style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}
              >
                <BarsIcon />
              </button>
              <button
                type="button"
                className={view === "line" ? "active" : ""}
                onClick={() => setView("line")}
                aria-label="Line"
                title="Line"
                style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}
              >
                <LineIcon />
              </button>
            </div>
            <div className="seg" role="group" aria-label="Period">
              {RANGES.map((r) => (
                <button key={r.key} type="button" className={range === r.key ? "active" : ""} onClick={() => setRange(r.key)}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {metric === "platform" && (
          <div className="growth-picker">
            {OPS_BY_PLATFORM.map((p) => (
              <button key={p.kind} type="button" className={`chip${platform === p.kind ? " active" : ""}`} onClick={() => setPlatform(p.kind)}>
                <SocialIcon kind={p.kind} width={16} height={16} />
                {p.label}
              </button>
            ))}
          </div>
        )}
        {metric === "game" && (
          <div className="growth-picker">
            {GAMES.map((g) => (
              <button key={g.id} type="button" className={`chip${game === g.id ? " active" : ""}`} onClick={() => setGame(g.id)}>
                <GameIcon id={g.id} width={16} height={16} />
                {g.title}
              </button>
            ))}
          </div>
        )}

        <div className="gv num">{money(rec[rec.length - 1] ?? 0)}</div>
        <GrowthChart data={rec} labels={dates} format={money} view={view} />
        <div className="mini-axis num">
          {axisTicks(dates).map((d, i) => (
            <span key={i}>{d}</span>
          ))}
        </div>
      </div>

      <div className="two-col">
        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>Donations by platform</h2>
              <div className="ph-sub">Where volume concentrates</div>
            </div>
          </div>
          <BarList
            unit="money"
            bars={OPS_BY_PLATFORM.map((p) => ({
              label: p.label,
              value: p.value,
              icon: <SocialIcon kind={p.kind} width={16} height={16} />,
              display: shortMoney(p.value),
            }))}
          />
        </div>
        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>Content makers by volume</h2>
              <div className="ph-sub">Distribution by donation amount</div>
            </div>
          </div>
          <BarList unit="count" bars={OPS_BY_SIZE} />
        </div>
      </div>

      <div className="two-col">
        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>Games</h2>
              <div className="ph-sub">How many pages have each one enabled</div>
            </div>
          </div>
          <BarList unit="count" bars={OPS_GAME_ADOPTION} />
        </div>
        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>Tasks by status</h2>
              <div className="ph-sub">1 paid out to content maker · 1 refunded to donator</div>
            </div>
          </div>
          <div className="barlist">
            {OPS_TASK_STATUS.map((t) => (
              <div className="barrow" key={t.label} style={{ gridTemplateColumns: "1fr auto" }}>
                <StatusPill tone={t.tone}>{t.label}</StatusPill>
                <span className="bv num">{t.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

type StreamerSortKey = "name" | "socials" | "received" | "d7" | "donators";

function Streamers() {
  const [sortKey, setSortKey] = useState<StreamerSortKey>("received");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [q, setQ] = useState("");

  function toggleSort(key: StreamerSortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = needle
      ? OPS_STREAMERS.filter((r) => r.handle.toLowerCase().includes(needle) || r.name.toLowerCase().includes(needle))
      : OPS_STREAMERS;
    const sign = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case "name":
          return sign * a.handle.localeCompare(b.handle);
        case "socials":
          return sign * (a.socials.length - b.socials.length);
        case "received":
          return sign * (a.received - b.received);
        case "d7":
          return sign * (a.d7 - b.d7);
        case "donators":
          return sign * (a.donators - b.donators);
      }
    });
  }, [sortKey, sortDir, q]);

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Content makers</h1>
          <div className="sub">{rows.length} of {OPS_STATS.streamers}</div>
        </div>
        <div className="admin-controls">
          <div className="search-field">
            <SearchIcon width={16} height={16} />
            <input type="text" placeholder="Find a content maker…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a content maker" />
          </div>
        </div>
      </div>

      <div className="panel" style={{ padding: 0 }}>
        <div className="otable-wrap">
          <table className="otable">
            <thead>
              <tr>
                <th className="rank">#</th>
                <SortHeader label="Content maker" active={sortKey === "name"} dir={sortDir} onClick={() => toggleSort("name")} />
                <SortHeader label="Socials" active={sortKey === "socials"} dir={sortDir} onClick={() => toggleSort("socials")} />
                <SortHeader label="Received" align="r" active={sortKey === "received"} dir={sortDir} onClick={() => toggleSort("received")} />
                <SortHeader label="7 days" align="r" active={sortKey === "d7"} dir={sortDir} onClick={() => toggleSort("d7")} />
                <SortHeader label="Donators" align="r" active={sortKey === "donators"} dir={sortDir} onClick={() => toggleSort("donators")} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.handle}>
                  <td className="rank num">{i + 1}</td>
                  <td>
                    <div className="who-cell">
                      <Link className="h" href={`/@${r.handle}`}>@{r.handle}</Link>
                      <span className="n">{r.name}</span>
                    </div>
                  </td>
                  <td>
                    <span className="socials-mini">
                      {r.socials.map((k) => (
                        <SocialIcon key={k} kind={k} width={16} height={16} />
                      ))}
                    </span>
                  </td>
                  <td className="r money num">{money(r.received)}</td>
                  <td className="r num" style={{ color: "var(--text-2)" }}>{money(r.d7)}</td>
                  <td className="r num">{r.donators}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", padding: "40px 16px", color: "var(--text-3)" }}>
                    No content maker matches "{q}".
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

type DonatorSortKey = "wallet" | "donated" | "reputation" | "streamers" | "activity";

// "Activity" only has a human string ("34 min ago") — approximate it to minutes-ago so the
// column can still sort by recency, without pretending the mock data has a real timestamp.
function recencyMinutes(s: string): number {
  const min = s.match(/(\d+)\s*min/);
  if (min) return +min[1];
  const hr = s.match(/(\d+)\s*hour/);
  if (hr) return +hr[1] * 60;
  if (/today/.test(s)) return 60 * 20;
  if (/yesterday/.test(s)) return 60 * 30;
  const day = s.match(/(\d+)\s*day/);
  if (day) return +day[1] * 60 * 24;
  return Number.MAX_SAFE_INTEGER;
}

function Donators() {
  const [sortKey, setSortKey] = useState<DonatorSortKey>("donated");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function toggleSort(key: DonatorSortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const rows = useMemo(() => {
    const sign = sortDir === "asc" ? 1 : -1;
    return [...OPS_DONATORS].sort((a, b) => {
      switch (sortKey) {
        case "wallet":
          return sign * a.addr.localeCompare(b.addr);
        case "donated":
          return sign * (a.donated - b.donated);
        case "reputation":
          return sign * (a.reputation - b.reputation);
        case "streamers":
          return sign * (a.streamers - b.streamers);
        case "activity":
          // most-recent-first is the natural "descending" for a recency column, so flip the sign
          return -sign * (recencyMinutes(a.last) - recencyMinutes(b.last));
      }
    });
  }, [sortKey, sortDir]);

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Donators</h1>
          <div className="sub">Top by reputation on the platform</div>
        </div>
      </div>
      <div className="panel" style={{ padding: 0 }}>
        <div className="otable-wrap">
          <table className="otable">
            <thead>
              <tr>
                <th className="rank">#</th>
                <SortHeader label="Wallet" active={sortKey === "wallet"} dir={sortDir} onClick={() => toggleSort("wallet")} />
                <SortHeader label="Donated" align="r" active={sortKey === "donated"} dir={sortDir} onClick={() => toggleSort("donated")} />
                <SortHeader label="Reputation" align="r" active={sortKey === "reputation"} dir={sortDir} onClick={() => toggleSort("reputation")} />
                <SortHeader label="Content makers" align="r" active={sortKey === "streamers"} dir={sortDir} onClick={() => toggleSort("streamers")} />
                <SortHeader label="Activity" align="r" active={sortKey === "activity"} dir={sortDir} onClick={() => toggleSort("activity")} />
              </tr>
            </thead>
            <tbody>
              {rows.map((v, i) => (
                <tr key={v.addr}>
                  <td className="rank num">{i + 1}</td>
                  <td className="mono-addr">{v.addr}</td>
                  <td className="r money num">{money(v.donated)}</td>
                  <td className="r num">{v.reputation}</td>
                  <td className="r num">{v.streamers}</td>
                  <td className="r" style={{ color: "var(--text-3)" }}>{v.last}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

const TASK_FILTERS: { key: string; label: string; match: (s: TaskStatus) => boolean }[] = [
  { key: "all", label: "All", match: () => true },
  { key: "live", label: "Active", match: (s) => ["await", "progress", "review"].includes(s) },
  { key: "disp", label: "Disputes", match: (s) => ["dispute", "vote"].includes(s) },
  { key: "done", label: "Completed", match: (s) => ["refund", "paid"].includes(s) },
];

function Tasks() {
  const [filter, setFilter] = useState("all");
  const match = TASK_FILTERS.find((f) => f.key === filter)!.match;
  const rows = OPS_TASKS.filter((t) => match(t.status));
  const total = OPS_TASKS.reduce((a, t) => a + t.amount, 0);

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Tasks</h1>
          <div className="sub">All escrow tasks across content makers — {OPS_TASKS.length} worth {money(total)} in play.</div>
        </div>
        <div className="admin-controls">
          <div className="seg">
            {TASK_FILTERS.map((f) => (
              <button key={f.key} type="button" className={filter === f.key ? "active" : ""} onClick={() => setFilter(f.key)}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="panel" style={{ padding: 0 }}>
        <div className="otable-wrap">
          <table className="otable">
            <thead>
              <tr>
                <th>Date</th>
                <th>Content maker</th>
                <th>Task</th>
                <th>Donator</th>
                <th className="r">Amount</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t, i) => {
                const meta = TASK_STATUS_META[t.status];
                return (
                  <tr key={i}>
                    <td style={{ color: "var(--text-3)", whiteSpace: "nowrap" }}>{t.date}</td>
                    <td><Link href={`/@${t.handle}`}>@{t.handle}</Link></td>
                    <td style={{ maxWidth: 420 }}>{t.task}</td>
                    <td className="mono-addr">{t.supporter}</td>
                    <td className="r money num">{money(t.amount)}</td>
                    <td>
                      <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
                      {meta.note ? <div style={{ fontSize: 13, color: "var(--text-3)", marginTop: 4 }}>{meta.note}</div> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function classify(text: string): { tone: "ok" | "attn" | "bad"; verdict: string; note: string } {
  const t = text.toLowerCase();
  if (/(child.*porn|csam|drugs|terroris)/.test(t)) return { tone: "bad", verdict: "Escalate", note: "Critical: preserve and hand off to law enforcement." };
  if (/(kill|threat|violence|porn|scam)/.test(t)) return { tone: "attn", verdict: "Hide", note: "Rule violation: the message is hidden, the content maker gets a flag." };
  if (!text.trim()) return { tone: "ok", verdict: "—", note: "Enter text to check." };
  return { tone: "ok", verdict: "Passed", note: "No violations found." };
}

function Moderation() {
  const [text, setText] = useState("");
  const [checked, setChecked] = useState<ReturnType<typeof classify> | null>(null);
  const [action, setAction] = useState(APPLY_ACTIONS[0]);
  const [reason, setReason] = useState("");
  const [target, setTarget] = useState("");
  const [preserve, setPreserve] = useState(false);
  const [log, setLog] = useState<{ action: string; target: string; reason: string; when: string }[]>([]);

  function apply() {
    if (!target) return;
    setLog((p) => [{ action, target, reason: reason || "—", when: "just now" }, ...p]);
    setReason("");
    setTarget("");
  }

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Moderation</h1>
          <div className="sub">Platform level: what a content maker can't do.</div>
        </div>
      </div>

      <div className="mod-stack">
        <div>
          <div className="panel-head"><div><h2>Check sandbox</h2><div className="ph-sub">Nothing is saved.</div></div></div>
          <div className="panel mod-sandbox">
            <div className="field">
              <label htmlFor="mod-text">Text to check</label>
              <textarea id="mod-text" placeholder="e.g.: great stream · spam · threat" value={text} onChange={(e) => setText(e.target.value)} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 16 }}>
              <button className="btn-outline" type="button" onClick={() => setChecked(classify(text))}>Check</button>
              {checked ? <StatusPill tone={checked.tone}>{checked.verdict}</StatusPill> : null}
            </div>
            {checked ? <div className="verdict" style={{ marginTop: 16 }}>{checked.note}</div> : null}
          </div>
        </div>

        <div>
          <div className="panel-head"><div><h2>Penalty ladder</h2><div className="ph-sub">From mild to severe</div></div></div>
          <div className="ladder">
            {PENALTY_LADDER.map((r) => (
              <div key={r.n} className={`rung${r.severe ? " severe" : ""}`}>
                <span className="num">{r.n}</span>
                {r.label}
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="panel-head"><div><h2>Apply a measure</h2></div></div>
          <div className="panel">
            <div className="apply-grid">
              <div className="field">
                <label>Action</label>
                <select value={action} onChange={(e) => setAction(e.target.value)}>
                  {APPLY_ACTIONS.map((a) => <option key={a}>{a}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Reason</label>
                <input type="text" placeholder="CSAM / flooding / sanctions" value={reason} onChange={(e) => setReason(e.target.value)} />
              </div>
              <div className="field">
                <label>Content maker</label>
                <select value={target} onChange={(e) => setTarget(e.target.value)}>
                  <option value="">— choose a content maker —</option>
                  {OPS_STREAMERS.map((r) => <option key={r.handle} value={r.handle}>@{r.handle}</option>)}
                </select>
              </div>
              <label className={`toggle${preserve ? " on" : ""}`} style={{ alignSelf: "end", height: 52 }}>
                <span className="track"><span className="knob" /></span>
                <input type="checkbox" hidden checked={preserve} onChange={(e) => setPreserve(e.target.checked)} />
                Preserve evidence + report
              </label>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 20 }}>
              <button className="btn-danger" type="button" disabled={!target} onClick={apply}>Apply measure</button>
              {!target ? <span className="footnote">Specify a target: content maker</span> : null}
            </div>
          </div>
        </div>

        <div>
          <div className="panel-head"><div><h2>Incident log</h2></div></div>
          {log.length === 0 ? (
            <div className="empty-log"><b style={{ color: "var(--text-1)" }}>No incidents</b></div>
          ) : (
            <div className="panel" style={{ padding: 0 }}>
              <div className="otable-wrap">
                <table className="otable">
                  <thead><tr><th>When</th><th>Action</th><th>Content maker</th><th>Reason</th></tr></thead>
                  <tbody>
                    {log.map((l, i) => (
                      <tr key={i}>
                        <td style={{ color: "var(--text-3)" }}>{l.when}</td>
                        <td>{l.action}</td>
                        <td>@{l.target}</td>
                        <td style={{ color: "var(--text-2)" }}>{l.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// Demo pages, seeded and removed from one place. The wipe only ever touches pages this panel
// created (the server tracks them); anything else in the DB is left alone, so there's no way to
// lose a real page by pressing the wrong button.
function TestData() {
  const [stat, setStat] = useState<{ test: number; total: number; seedSize: number } | null>(null);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const confirm = useConfirm();

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/test-data", { cache: "no-store" });
      if (r.ok) setStat(await r.json());
    } catch {}
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: "seed" | "wipe") {
    setBusy(action);
    setNote("");
    try {
      const r = await fetch("/api/admin/test-data", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const j = (await r.json()) as { added?: number; removed?: number; error?: string };
      if (!r.ok) setNote(j.error ?? "Didn't work.");
      else if (action === "seed")
        setNote(j.added ? `Added ${j.added} demo page${j.added === 1 ? "" : "s"}.` : "They're already there.");
      else setNote(j.removed ? `Removed ${j.removed} demo page${j.removed === 1 ? "" : "s"}.` : "Nothing to remove.");
      void load();
    } catch {
      setNote("Didn't work.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="panel" style={{ maxWidth: 640 }}>
      <div className="panel-head">
        <div>
          <h2>Test data</h2>
          <div className="ph-sub">Only these are ever deleted.</div>
        </div>
      </div>

      <p className="footnote" style={{ marginTop: 0 }}>
        {stat ? `${stat.test} demo page${stat.test === 1 ? "" : "s"} of ${stat.total} total.` : "Counting…"}
      </p>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
        {/* Both go through the one confirmation the rest of the product uses — this screen used to
            roll its own inline "Yes, remove N" toggle, which read as a different kind of decision. */}
        <button
          type="button"
          className="btn-outline"
          disabled={!!busy}
          onClick={() => confirm(dangerCopy.seedData(), () => void run("seed"))}
        >
          {busy === "seed" ? "Adding…" : "Add test data"}
        </button>
        <button
          type="button"
          className="btn-outline"
          disabled={!!busy || !stat?.test}
          onClick={() => confirm(dangerCopy.wipeData(stat?.test ?? 0), () => void run("wipe"), { danger: true })}
        >
          {busy === "wipe" ? "Removing…" : "Remove test data"}
        </button>
      </div>

      {note && <p className="footnote" style={{ marginTop: 12 }}>{note}</p>}
      {confirm.dialog}
    </div>
  );
}

function Settings() {
  const { mode, setMode, demoData, setDemoData, ready } = useCheer();

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Settings</h1>
          <div className="sub">Admin panel parameters.</div>
        </div>
      </div>

      <div className="panel" style={{ maxWidth: 640 }}>
        <div className="panel-head">
          <div>
            <h2>Data source</h2>
          </div>
        </div>
        {ready && (
          <div className="seg" role="group" aria-label="Data source">
            <button type="button" className={mode === "mock" ? "active" : ""} onClick={() => setMode("mock")}>
              Mock
            </button>
            <button type="button" className={mode === "chain" ? "active" : ""} onClick={() => setMode("chain")}>
              Chain
            </button>
          </div>
        )}
      </div>

      <div className="panel" style={{ maxWidth: 640 }}>
        <div className="panel-head">
          <div>
            <h2>Demo numbers</h2>
            <div className="ph-sub">
              Off by default — the cabinet dashboard shows real totals and the creator catalog lists only real makers. Turn on
              to seed sample numbers and demo streamers for screenshots. Demo figures show in red in the dashboard.
            </div>
          </div>
        </div>
        {ready && (
          <div className="seg" role="group" aria-label="Demo numbers">
            <button type="button" className={!demoData ? "active" : ""} onClick={() => setDemoData(false)}>
              Off
            </button>
            <button type="button" className={demoData ? "active" : ""} onClick={() => setDemoData(true)}>
              On
            </button>
          </div>
        )}
      </div>

      <TestData />
    </>
  );
}
