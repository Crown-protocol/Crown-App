"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { NavIcon } from "@/components/icons";
import { CheerBadge } from "@/components/CheerBadge";
import { LaunchReadiness } from "@/components/LaunchReadiness";
import { BotPanel } from "@/components/admin/BotPanel";
import { BarsIcon, LineIcon } from "@/components/Chart";
import { StatTile, GrowthChart, SortHeader, money, shortMoney, axisTicks } from "@/components/ops";
import { USDC_DECIMALS } from "@/lib/chain/config";

// The operations panel. Every figure here is measured — mirrored `Settled` rows
// and registered pages, nothing seeded and nothing projected.
//
// It used to open on a demo dataset (a five-figure "revenue", invented creators,
// a moderation queue of invented reports). Those screens are gone rather than
// re-plumbed: a panel that can show a plausible number nobody earned teaches you
// to trust the next one, and there was no real source behind them to plumb to.
//
// What is left is what exists: the money that moved, who moved it, who received
// it, whether the bot is up, and whether the perimeter is wired.

type Section = "overview" | "creators" | "donors" | "bot" | "launch";

const NAV: { key: Section; label: string; icon: () => JSX.Element }[] = [
  { key: "overview", label: "Overview", icon: () => <NavIcon name="home" /> },
  { key: "creators", label: "Creators", icon: () => <PeopleIcon /> },
  { key: "donors", label: "Donors", icon: () => <DonorIcon /> },
  { key: "bot", label: "Telegram bot", icon: () => <NavIcon name="settings" /> },
  { key: "launch", label: "Launch readiness", icon: () => <ChecklistIcon /> },
];

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

function DonorIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 20s-7-4.5-7-9.2A4 4 0 0 1 12 8a4 4 0 0 1 7 2.8C19 15.5 12 20 12 20z" />
    </svg>
  );
}

function ChecklistIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 7l2 2 3.5-3.5" />
      <path d="M4 15l2 2 3.5-3.5" />
      <path d="M13 7h7" />
      <path d="M13 15h7" />
    </svg>
  );
}

// ---- the one fetch behind every screen ----

interface Overview {
  profiles: number;
  donations: number;
  grossTotal: number;
  gross30d: number;
  donations30d: number;
  donors: number;
  recipients: number;
  cursor: string | null;
}
interface Recipient {
  address: string;
  handle: string | null;
  name: string | null;
  gross: number;
  count: number;
  last: number | null;
}
interface Donor {
  payer: string;
  gross: number;
  count: number;
  recipients: number;
  last: number | null;
}
interface Daily {
  date: string;
  gross: number;
  count: number;
}
interface Ops {
  overview: Overview;
  recipients: Recipient[];
  donors: Donor[];
  daily: Daily[];
}

const dollars = (minor: number) => minor / 10 ** USDC_DECIMALS;
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const ago = (unix: number | null) => {
  if (!unix) return "—";
  const mins = Math.max(0, Math.round((Date.now() / 1000 - unix) / 60));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)} h ago`;
  return `${Math.floor(mins / 1440)} d ago`;
};

function useOps(): { ops: Ops | null; error: string } {
  const [ops, setOps] = useState<Ops | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/stats", { cache: "no-store" });
      if (!r.ok) {
        setError("Couldn't read the numbers.");
        return;
      }
      setOps((await r.json()) as Ops);
      setError("");
    } catch {
      setError("Couldn't read the numbers.");
    }
  }, []);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);
  return { ops, error };
}

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
        {NAV.map((n) => (
          <button key={n.key} type="button" className={`admin-item${section === n.key ? " active" : ""}`} onClick={() => setSection(n.key)}>
            <n.icon />
            {n.label}
          </button>
        ))}
      </nav>

      {/* key on the section: React remounts the column when you switch, so the entrance
          cascade (globals.css .admin-main > *) replays for the newly shown content */}
      <div className="admin-main" key={section}>
        {section === "overview" && <OverviewSection />}
        {section === "creators" && <CreatorsSection />}
        {section === "donors" && <DonorsSection />}
        {section === "bot" && <BotPanel />}
        {section === "launch" && <LaunchReadiness />}
      </div>
    </main>
  );
}

function OverviewSection() {
  const { ops, error } = useOps();
  const [view, setView] = useState<"bars" | "line">("bars");

  const series = useMemo(() => {
    if (!ops) return { data: [] as number[], labels: [] as string[] };
    return {
      data: ops.daily.map((d) => dollars(d.gross)),
      labels: ops.daily.map((d) => d.date.slice(5)),
    };
  }, [ops]);

  if (error) return <div className="panel"><p className="footnote">{error}</p></div>;
  if (!ops) return <div className="panel"><p className="footnote">Reading the ledger…</p></div>;

  const o = ops.overview;
  return (
    <>
      <div className="stats">
        <StatTile k="Donations" v={String(o.donations)} s={`${o.donations30d} in the last 30 days`} />
        <StatTile k="Money moved" v={money(dollars(o.grossTotal))} s={`${money(dollars(o.gross30d))} in the last 30 days`} />
        <StatTile k="Donors" v={String(o.donors)} s="distinct paying wallets" />
        <StatTile k="Creators paid" v={String(o.recipients)} s={`${o.profiles} pages registered`} />
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>Last 30 days</h2>
            <div className="ph-sub">Mirrored from finalized settlements — the mirror lags the chain by a minute at most.</div>
          </div>
          <div className="seg">
            <button type="button" className={view === "bars" ? "active" : ""} onClick={() => setView("bars")} aria-label="Bars">
              <BarsIcon />
            </button>
            <button type="button" className={view === "line" ? "active" : ""} onClick={() => setView("line")} aria-label="Line">
              <LineIcon />
            </button>
          </div>
        </div>
        {series.data.length ? (
          <GrowthChart data={series.data} labels={axisTicks(series.labels)} view={view} format={(v) => shortMoney(v)} />
        ) : (
          <p className="footnote">No donations in this window yet.</p>
        )}
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>Mirror</h2>
            <div className="ph-sub">The last signature our indexer folded into the local mirror.</div>
          </div>
        </div>
        <p className="footnote mono" style={{ wordBreak: "break-all", marginTop: 0 }}>
          {o.cursor ?? "nothing indexed yet"}
        </p>
      </div>
    </>
  );
}

type CreatorSort = "gross" | "count" | "last";

function CreatorsSection() {
  const { ops, error } = useOps();
  const [sort, setSort] = useState<CreatorSort>("gross");
  const [desc, setDesc] = useState(true);
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    if (!ops) return [];
    const needle = q.trim().toLowerCase();
    const filtered = needle
      ? ops.recipients.filter(
          (r) =>
            r.address.toLowerCase().includes(needle) ||
            (r.handle ?? "").toLowerCase().includes(needle) ||
            (r.name ?? "").toLowerCase().includes(needle)
        )
      : ops.recipients;
    const dir = desc ? -1 : 1;
    return [...filtered].sort((a, b) => dir * ((a[sort] ?? 0) > (b[sort] ?? 0) ? 1 : (a[sort] ?? 0) < (b[sort] ?? 0) ? -1 : 0));
  }, [ops, sort, desc, q]);

  function toggle(key: CreatorSort) {
    if (key === sort) setDesc((d) => !d);
    else {
      setSort(key);
      setDesc(true);
    }
  }

  if (error) return <div className="panel"><p className="footnote">{error}</p></div>;

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>Creators</h2>
          <div className="ph-sub">Everyone who has actually been paid. A row with no page is a wallet paid through a link that no longer resolves.</div>
        </div>
        <input className="input" placeholder="handle, name or address" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 260 }} />
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Page</th>
            <th>Payout address</th>
            <SortHeader label="Received" active={sort === "gross"} dir={desc ? "desc" : "asc"} onClick={() => toggle("gross")} />
            <SortHeader label="Donations" active={sort === "count"} dir={desc ? "desc" : "asc"} onClick={() => toggle("count")} />
            <SortHeader label="Last" active={sort === "last"} dir={desc ? "desc" : "asc"} onClick={() => toggle("last")} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.address}>
              <td>{r.handle ? <Link href={`/@${r.handle}`}>@{r.handle}</Link> : <span className="footnote">no page</span>}</td>
              <td className="mono">{short(r.address)}</td>
              <td className="num">{money(dollars(r.gross))}</td>
              <td className="num">{r.count}</td>
              <td>{ago(r.last)}</td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={5} className="footnote">Nobody has been paid yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

type DonorSort = "gross" | "count" | "recipients" | "last";

function DonorsSection() {
  const { ops, error } = useOps();
  const [sort, setSort] = useState<DonorSort>("gross");
  const [desc, setDesc] = useState(true);

  const rows = useMemo(() => {
    if (!ops) return [];
    const dir = desc ? -1 : 1;
    return [...ops.donors].sort((a, b) => dir * ((a[sort] ?? 0) > (b[sort] ?? 0) ? 1 : (a[sort] ?? 0) < (b[sort] ?? 0) ? -1 : 0));
  }, [ops, sort, desc]);

  function toggle(key: DonorSort) {
    if (key === sort) setDesc((d) => !d);
    else {
      setSort(key);
      setDesc(true);
    }
  }

  if (error) return <div className="panel"><p className="footnote">{error}</p></div>;

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>Donors</h2>
          <div className="ph-sub">Paying wallets, as the book credits them — an escrow-settled donation counts for the person who funded it, not the escrow.</div>
        </div>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Wallet</th>
            <SortHeader label="Given" active={sort === "gross"} dir={desc ? "desc" : "asc"} onClick={() => toggle("gross")} />
            <SortHeader label="Donations" active={sort === "count"} dir={desc ? "desc" : "asc"} onClick={() => toggle("count")} />
            <SortHeader label="Creators" active={sort === "recipients"} dir={desc ? "desc" : "asc"} onClick={() => toggle("recipients")} />
            <SortHeader label="Last" active={sort === "last"} dir={desc ? "desc" : "asc"} onClick={() => toggle("last")} />
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.payer}>
              <td className="mono">{short(d.payer)}</td>
              <td className="num">{money(dollars(d.gross))}</td>
              <td className="num">{d.count}</td>
              <td className="num">{d.recipients}</td>
              <td>{ago(d.last)}</td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={5} className="footnote">No donations yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
