"use client";

import { useEffect, useRef, useState } from "react";
import { SearchIcon, NavIcon, GameIcon } from "@/components/icons";
import { OVERLAYS, type OverlayDef, type OverlayKind } from "@/lib/data/overlays";
import { GAMES, type GameId } from "@/lib/data/games";
import { Widget as WidgetMockup } from "@/components/ObsWidgets";
import { ObsGuideModal } from "@/components/ObsGuideModal";
import styles from "./WidgetsPanel.module.css";

// ---- Card preview -------------------------------------------------------------------------------

// The preview is the SAME populated mockup the landing hero shows, sitting on a dark gameplay-ish
// backdrop so it reads exactly like the widget will over a stream. A live-scaled REAL overlay was a
// tiny unreadable speck in a 330px card (and empty for game widgets with no local data) — the
// mockup is always clear, self-contained, and needs no data or demo pump.
function WidgetPreview({ kind }: { kind: OverlayKind }) {
  return (
    <div className={styles.preview} aria-hidden="true">
      <div className={styles.previewCard}>
        <WidgetMockup kind={kind} />
      </div>
    </div>
  );
}

// ---- Per-card URL extras ------------------------------------------------------------------------

// Recommended Browser Source size per kind — OBS (and Streamlabs Desktop, which is an OBS fork with
// the same source type) asks for width/height when adding a source, and a wrong size silently crops
// the widget. Copied as "800x260" (what those fields want).
const OBS_SIZE: Record<string, [number, number]> = {
  alerts: [800, 260],
  rank: [800, 260],
  goal: [800, 220],
  top: [320, 420],
  roulette: [480, 300],
  task: [520, 220],
  fundraiser: [420, 160],
  ticker: [1920, 64],
  qr: [220, 220],
  session: [320, 80],
  record: [320, 200],
  train: [320, 140],
};

// Minimal per-widget params the overlay routes already parse (the num() pattern in
// app/overlay/[handle]/[widget]/page.tsx). Empty inputs stay out of the URL.
interface ParamField {
  key: string;
  label: string;
  ph: string; // placeholder doubles as the only hint — no helper lines (owner's rule)
  numeric?: boolean;
}
const PARAM_FIELDS: Partial<Record<string, ParamField[]>> = {
  goal: [
    { key: "title", label: "Title", ph: "Stream goal" },
    { key: "goal", label: "Goal $", ph: "500", numeric: true },
  ],
  alerts: [{ key: "min", label: "Min $", ph: "0", numeric: true }],
  top: [{ key: "n", label: "Rows", ph: "5", numeric: true }],
  fundraiser: [{ key: "goal", label: "Goal $", ph: "2000", numeric: true }],
};

// Transient "done" flag for copy-style buttons; the timer is cleaned up on unmount so a category
// switch mid-flash never fires a setState on a dead card.
function useFlash(ms = 1600): [boolean, () => void] {
  const [on, setOn] = useState(false);
  const t = useRef(0);
  useEffect(() => () => window.clearTimeout(t.current), []);
  const flash = () => {
    setOn(true);
    window.clearTimeout(t.current);
    t.current = window.setTimeout(() => setOn(false), ms);
  };
  return [on, flash];
}

function OverlayCard({ handle, kind, label, desc }: { handle: string; kind: OverlayKind; label: string; desc: string }) {
  // Resolve the real host after mount (dev vs prod) to avoid an SSR/client hydration mismatch —
  // the same pattern PageBuilder uses. Rendering window.location.origin during render diverges from SSR.
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  const fields = PARAM_FIELDS[kind] ?? [];
  const [params, setParams] = useState<Record<string, string>>({});
  // "Demo data" appends ?demo=1 — rehearse a lively scene, then untoggle and re-copy for going live.
  const [demoUrl, setDemoUrl] = useState(false);

  const query = new URLSearchParams();
  for (const f of fields) {
    const v = (params[f.key] ?? "").trim();
    if (v) query.set(f.key, v);
  }
  if (demoUrl) query.set("demo", "1");
  const qs = query.toString();
  const url = `${origin || "https://cheer.tv"}/overlay/@${handle}/${kind}${qs ? `?${qs}` : ""}`;

  const [copied, flashCopied] = useFlash();
  // What OBS should be told in its Width/Height fields — wrong values crop the widget silently.
  const [w, h] = OBS_SIZE[kind] ?? [800, 260];

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      flashCopied();
    } catch {}
  }

  return (
    <div className={styles.card}>
      <WidgetPreview kind={kind} />
      <div className={styles.cardBody}>
        <div className={styles.cardTitle}>{label}</div>
        <p className={styles.cardDesc}>{desc}</p>

        {/* The link IS the copy button — one obvious target instead of a row of buttons around it.
            The size rides along as a quiet note: it's information, not an action. */}
        <button type="button" className={styles.urlRow} onClick={copy} title="Click to copy — paste into a Browser Source">
          <span className={styles.url}>{copied ? "Copied" : url.replace(/^https?:\/\//, "")}</span>
          <span className={styles.sizeNote}>
            {w}×{h}
          </span>
        </button>

        {/* One line for everything adjustable: the params (short values, so short fields), the demo
            toggle, and the preview link. Two stacked rows for this much was mostly empty space. */}
        <div className={styles.metaRow}>
          {fields.map((f) => (
            <label className={styles.paramField} key={f.key}>
              <span className={styles.paramLabel}>{f.label}</span>
              <input
                className={styles.paramInput}
                type={f.numeric ? "number" : "text"}
                inputMode={f.numeric ? "numeric" : undefined}
                min={f.numeric ? 0 : undefined}
                placeholder={f.ph}
                value={params[f.key] ?? ""}
                onChange={(e) => setParams((p) => ({ ...p, [f.key]: e.target.value }))}
                aria-label={`${label}: ${f.label}`}
              />
            </label>
          ))}
          <label className={`${styles.demoToggle} ${demoUrl ? styles.demoOn : ""}`} title="Adds ?demo=1 — fabricated donations for rehearsal">
            <input type="checkbox" checked={demoUrl} onChange={(e) => setDemoUrl(e.target.checked)} />
            Demo data
          </label>
          <a className={styles.openLink} href={url} target="_blank" rel="noreferrer">
            Open ↗
          </a>
        </div>
      </div>
    </div>
  );
}

// Categories come from the data, not a hand-kept list: "General" is everything not tied to a game,
// then one per mini-game that actually ships a widget — so adding a game widget adds its category,
// with the game's own title as the label.
type Cat = "all" | "general" | GameId;

const CATS: { key: Cat; label: string }[] = [
  { key: "all", label: "All" },
  { key: "general", label: "General" },
  ...GAMES.filter((g) => OVERLAYS.some((o) => o.game === g.id)).map((g) => ({ key: g.id as Cat, label: g.title })),
];

const inCat = (o: OverlayDef, c: Cat) => (c === "all" ? true : c === "general" ? !o.game : o.game === c);

// Every row carries an icon, like the platform rows on /discover: the games use their own game
// icon, so a category reads as the game it belongs to at a glance.
function CatIcon({ cat }: { cat: Cat }) {
  if (cat === "all") return <NavIcon name="widgets" />;
  if (cat === "general") return <NavIcon name="donations" />;
  return <GameIcon id={cat} width={16} height={16} />;
}

export function WidgetsPanel({ handle }: { handle: string }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<Cat>("all");
  const [guideOpen, setGuideOpen] = useState(false);
  // Streamlabs link state: `available` is whether this server has the app credentials at all —
  // without them the button would lead nowhere, so it simply isn't shown.
  const [sl, setSl] = useState<{ available: boolean; connected: boolean } | null>(null);
  const [slBusy, setSlBusy] = useState(false);

  useEffect(() => {
    if (!handle) return;
    let dead = false;
    void fetch(`/api/streamlabs/status?handle=${encodeURIComponent(handle)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!dead && j) setSl({ available: !!j.available, connected: !!j.connected });
      })
      .catch(() => {});
    return () => {
      dead = true;
    };
  }, [handle]);

  async function disconnectSl() {
    setSlBusy(true);
    try {
      await fetch(`/api/streamlabs/status?handle=${encodeURIComponent(handle)}`, { method: "DELETE", credentials: "same-origin" });
      setSl((v) => (v ? { ...v, connected: false } : v));
    } catch {
    } finally {
      setSlBusy(false);
    }
  }

  const term = q.trim().toLowerCase();
  const hits = (o: OverlayDef) => !term || o.label.toLowerCase().includes(term) || o.desc.toLowerCase().includes(term);
  const shown = OVERLAYS.filter((o) => inCat(o, cat) && hits(o));
  // counts follow the search, so a category tells you what you'd actually get if you clicked it
  const countIn = (c: Cat) => OVERLAYS.filter((o) => inCat(o, c) && hits(o)).length;

  return (
    <div className={styles.wrap}>
      <div className={styles.helpRow}>
        <p className={styles.help}>
          Add any overlay to <b>OBS</b> or <b>Streamlabs Desktop</b> as a <b>Browser Source</b> — paste its URL. It
          updates live when someone donates.
        </p>
        <button
          type="button"
          className={styles.helpQ}
          aria-expanded={guideOpen}
          onClick={() => setGuideOpen((v) => !v)}
          aria-label="How to add a widget to OBS or Streamlabs Desktop"
        >
          ?
        </button>
      </div>

      {sl?.available && (
        <div className={styles.slRow}>
          <span className={styles.slText}>
            {sl.connected
              ? "Cheer donations also fire your Streamlabs alert."
              : "Already have a Streamlabs alert box? Fire it on Cheer donations too."}
          </span>
          {sl.connected ? (
            <button type="button" className="btn-outline" disabled={slBusy} onClick={() => void disconnectSl()}>
              {slBusy ? "Disconnecting…" : "Disconnect"}
            </button>
          ) : (
            <a className="btn-outline" href={`/api/streamlabs/connect?handle=${encodeURIComponent(handle)}`}>
              Connect Streamlabs
            </a>
          )}
        </div>
      )}

      {guideOpen && <ObsGuideModal onClose={() => setGuideOpen(false)} />}

      <div className={styles.body}>
        <aside className={styles.sidebar}>
          <div className="search-field">
            <SearchIcon width={16} height={16} />
            <input type="text" placeholder="Search widgets…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search widgets" />
          </div>

          <div className={styles.filterGroup}>
            <div className={styles.filterLabel}>Categories</div>
            <div className={styles.catList}>
              {CATS.map((c) => {
                const n = countIn(c.key);
                return (
                  <button
                    key={c.key}
                    type="button"
                    className={`${styles.catRow} ${cat === c.key ? styles.catOn : ""}`}
                    aria-pressed={cat === c.key}
                    // nothing to show and not the current pick → nothing to click
                    disabled={n === 0 && cat !== c.key}
                    onClick={() => setCat(c.key)}
                  >
                    <CatIcon cat={c.key} />
                    <span className={styles.catLabel}>{c.label}</span>
                    <span className={styles.catCount}>{n}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        {shown.length === 0 ? (
          <div className="empty-log">No widget matches “{q.trim()}”.</div>
        ) : (
          <div className={styles.grid}>
            {shown.map((o) => (
              <OverlayCard key={o.kind} handle={handle} kind={o.kind} label={o.label} desc={o.desc} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
