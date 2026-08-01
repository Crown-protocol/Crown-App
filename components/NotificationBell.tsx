"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  seedNotifications,
  timeAgo,
  timeLeft,
  URGENCY_LABEL,
  URGENCY_OF,
  type Notif,
  type NotifUrgency,
} from "@/lib/data/notifications";
import { useDonationStream } from "@/lib/data/useDonationStream";
import styles from "./NotificationBell.module.css";

function BellIcon({ ringing }: { ringing: boolean }) {
  return (
    <svg className={ringing ? styles.bellRing : undefined} width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type Filter = "all" | NotifUrgency;
const FILTERS: Filter[] = ["all", "action", "money", "nice", "digest", "system"];

// A short two-note chime, synthesized on the spot — no audio file to ship. Wrapped in try:
// browsers block audio before the first user gesture, and a blocked ding must not break anything.
//
// ONE shared AudioContext for the page's lifetime, resumed if the browser suspended it. Creating a
// fresh context per donation (and closing it on a timer) piled up contexts during a raid until the
// browser's ~6-context cap was hit and the chime went silent.
let sharedCtx: AudioContext | null = null;
function ding() {
  try {
    if (!sharedCtx) sharedCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const ctx = sharedCtx;
    if (ctx.state === "suspended") void ctx.resume();
    const play = (freq: number, at: number) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, ctx.currentTime + at);
      g.gain.linearRampToValueAtTime(0.18, ctx.currentTime + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + at + 0.5);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + at);
      o.stop(ctx.currentTime + at + 0.55);
    };
    play(880, 0); // A5
    play(1174.66, 0.09); // D6
  } catch {}
}

// The streamer's notification bell. Mock feed for now (lib/data/notifications.ts) — when the backend
// lands, only the source of `items` changes; everything below stays.
// Opening the panel marks EVERYTHING read — seeing the list is reading it; nobody should have to
// click 9+ rows to silence a badge. New arrivals chime and light the badge again.
export function NotificationBell({ handle }: { handle?: string }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [items, setItems] = useState<Notif[]>([]);
  const [now, setNow] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(false);
  openRef.current = open;

  // Seeded on the client only: the feed is relative to "now", and rendering it on the server would
  // hydrate against a different clock.
  useEffect(() => {
    const t = Date.now();
    setNow(t);
    setItems(seedNotifications(t));
  }, []);

  // keeps "in 12m" / "4h ago" honest without re-seeding
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  // Live arrivals: every donation on this streamer's page lands here in real time — with the
  // chime. If the panel is already open, the row arrives pre-read (the user is looking at it).
  useDonationStream(handle ?? "", (e) => {
    const n: Notif = {
      id: `live-${e.ts}-${Math.random().toString(36).slice(2, 6)}`,
      kind: "donation",
      urgency: URGENCY_OF.donation,
      title: `${e.from} donated $${e.amount}`,
      body: e.message ?? "",
      at: Date.now(),
      read: openRef.current,
    };
    setItems((v) => [n, ...v]);
    setNow(Date.now());
    ding();
  });

  // click-away + Esc
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const unread = items.filter((n) => !n.read).length;
  const actionUnread = items.filter((n) => !n.read && n.urgency === "action").length;

  const shown = useMemo(() => (filter === "all" ? items : items.filter((n) => n.urgency === filter)), [items, filter]);

  // Count per filter, so the tabs say how much is behind them instead of hiding it.
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.filter((n) => !n.read).length };
    for (const f of FILTERS) if (f !== "all") c[f] = items.filter((n) => n.urgency === f && !n.read).length;
    return c;
  }, [items]);

  const markAllRead = () => setItems((v) => v.map((n) => ({ ...n, read: true })));
  const markRead = (id: string) => setItems((v) => v.map((n) => (n.id === id ? { ...n, read: true } : n)));

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={`${styles.bell}${open ? " " + styles.bellOpen : ""}`}
        onClick={() =>
          setOpen((v) => {
            // opening counts as reading — the badge dies here, not after 9+ clicks
            if (!v) setItems((list) => list.map((n) => ({ ...n, read: true })));
            return !v;
          })
        }
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
      >
        <BellIcon ringing={actionUnread > 0 && !open} />
        {unread > 0 && (
          /* the badge counts everything, but only turns solid when something actually needs a decision */
          <span className={`${styles.badge}${actionUnread ? " " + styles.badgeAction : ""}`}>{unread > 9 ? "9+" : unread}</span>
        )}
      </button>

      {open && (
        <div className={styles.panel} role="dialog" aria-label="Notifications">
          <div className={styles.head}>
            <span className={styles.headTitle}>Notifications</span>
            {unread > 0 && (
              <button className={styles.markAll} onClick={markAllRead}>
                Mark all read
              </button>
            )}
          </div>

          <div className={styles.tabs}>
            {FILTERS.map((f) => (
              <button
                key={f}
                className={`${styles.tab}${filter === f ? " " + styles.tabOn : ""}`}
                onClick={() => setFilter(f)}
              >
                {f === "all" ? "All" : URGENCY_LABEL[f]}
                {counts[f] > 0 && <span className={styles.tabCount}>{counts[f]}</span>}
              </button>
            ))}
          </div>

          <div className={styles.list}>
            {shown.length === 0 ? (
              <p className={styles.empty}>Nothing here.</p>
            ) : (
              shown.map((n) => {
                const row = (
                  <>
                    <span className={`${styles.mark} ${styles[`mark_${n.urgency}`]}`} aria-hidden />
                    <span className={styles.body}>
                      <span className={styles.rowTop}>
                        <span className={styles.title}>{n.title}</span>
                        {!n.read && <span className={styles.dot} aria-hidden />}
                      </span>
                      <span className={styles.text}>{n.body}</span>
                      <span className={styles.meta}>
                        {n.deadline && now ? (
                          <span className={`${styles.deadline}${n.deadline - now < 3600000 ? " " + styles.deadlineHot : ""}`}>
                            {timeLeft(n.deadline, now)}
                          </span>
                        ) : null}
                        <span className={styles.ago}>{now ? timeAgo(n.at, now) : ""}</span>
                      </span>
                    </span>
                  </>
                );

                return n.href ? (
                  <Link key={n.id} href={n.href} className={`${styles.row}${n.read ? "" : " " + styles.rowUnread}`} onClick={() => markRead(n.id)}>
                    {row}
                  </Link>
                ) : (
                  <button key={n.id} className={`${styles.row}${n.read ? "" : " " + styles.rowUnread}`} onClick={() => markRead(n.id)}>
                    {row}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
