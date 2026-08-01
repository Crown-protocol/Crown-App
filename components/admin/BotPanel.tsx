"use client";

import { useCallback, useEffect, useState } from "react";
import { BOT_SCENARIOS, type BotScenario } from "@/lib/data/bot-scenarios";
import { URGENCY_OF, URGENCY_LABEL, type NotifUrgency } from "@/lib/data/notifications";
import styles from "./BotPanel.module.css";

// The admin panel's Telegram tab: is the bot alive, who's connected, is anything stuck in the
// delivery queue — and every message the bot can send, grouped by category, each with a button that
// fires that exact notification at a connected chat.
//
// The point is that "what can the bot say, and does it actually say it?" should be readable, not
// archaeology. Scenarios that nothing emits yet are shown too, marked as not wired — that list is
// the remaining work, and hiding it would just make the bot look more complete than it is.

interface BotStatus {
  bot: { username: string | null; running: boolean; lastSeen: number; secretConfigured: boolean; founderSecretConfigured: boolean };
  links: { handle: string; name: string; tgName: string; chatId: number; monthly: boolean; categories: Record<string, boolean>; at: number }[];
  founders: number;
  pendingCodes: number;
  queue: { total: number; retrying: number; dead: number; inflight: number; size: number; lastError: string | null };
}

const ORDER: NotifUrgency[] = ["action", "money", "nice", "digest", "system"];

function ago(ts: number): string {
  if (!ts) return "never";
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

export function BotPanel() {
  const [data, setData] = useState<BotStatus | null>(null);
  const [error, setError] = useState("");
  // Which categories are expanded. "Needs you" starts open — it's the one that costs money to miss.
  const [open, setOpen] = useState<Record<string, boolean>>({ action: true });
  const [target, setTarget] = useState("");
  const [force, setForce] = useState(false);
  const [sending, setSending] = useState("");
  const [result, setResult] = useState<{ kind: string; text: string; ok: boolean } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/bot", { cache: "no-store" });
      if (r.status === 403) {
        setError("Admin only — connect the platform owner's wallet.");
        return;
      }
      if (!r.ok) throw new Error(String(r.status));
      const json = (await r.json()) as BotStatus;
      setData(json);
      setError("");
      setTarget((t) => t || json.links[0]?.handle || "");
    } catch {
      setError("Couldn't load the bot's status.");
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 10000); // the running/queue numbers are live
    return () => clearInterval(t);
  }, [load]);

  async function sendTest(s: BotScenario) {
    if (!target) return;
    setSending(s.kind);
    setResult(null);
    try {
      const r = await fetch("/api/admin/bot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: target, kind: s.kind, force }),
      });
      const json = (await r.json()) as { queued?: boolean; error?: string };
      if (!r.ok) {
        setResult({ kind: s.kind, text: json.error ?? "Failed to send.", ok: false });
      } else if (!json.queued) {
        setResult({
          kind: s.kind,
          text: `Filtered: "${URGENCY_LABEL[URGENCY_OF[s.kind]]}" is switched off for that page. Tick "ignore their settings" to preview it anyway.`,
          ok: false,
        });
      } else {
        setResult({ kind: s.kind, text: "Queued — it should arrive in a couple of seconds.", ok: true });
      }
      void load();
    } catch {
      setResult({ kind: s.kind, text: "Failed to send.", ok: false });
    } finally {
      setSending("");
    }
  }

  const wiredCount = BOT_SCENARIOS.filter((s) => s.wired).length;

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Telegram bot</h1>
          <div className="sub">Status, connections and every message the bot can send.</div>
        </div>
      </div>

      {error && (
        <div className="notice">
          <b>{error}</b> The live status and connected chats need the owner wallet; the catalogue below is
          just documentation and stays readable.
        </div>
      )}

      {/* ---- health ---- */}
      {!error && (
      <div className="stat-grid">
        <div className="stat">
          <div className="k">Bot</div>
          <div className="v" style={{ fontSize: 22 }}>
            {data?.bot.running ? "Running" : "Not running"}
          </div>
          <div className="s">
            {data?.bot.username ? `@${data.bot.username}` : "never connected"} · seen {ago(data?.bot.lastSeen ?? 0)}
          </div>
        </div>
        <div className="stat">
          <div className="k">Connected pages</div>
          <div className="v num">{data?.links.length ?? 0}</div>
          <div className="s">{data?.founders ?? 0} founder chats · {data?.pendingCodes ?? 0} pending codes</div>
        </div>
        <div className="stat">
          <div className="k">Queue</div>
          <div className="v num">{data?.queue.total ?? 0}</div>
          <div className="s">
            {data?.queue.inflight ?? 0} sending · {data?.queue.retrying ?? 0} retrying · {data?.queue.dead ?? 0} gave up
          </div>
        </div>
        <div className="stat">
          <div className="k">Scenarios</div>
          <div className="v num">
            {wiredCount}/{BOT_SCENARIOS.length}
          </div>
          <div className="s">wired up and emitting</div>
        </div>
      </div>
      )}

      {/* Configuration problems are silent by nature — a mismatched secret looks exactly like
          "nothing is happening", so say it plainly. */}
      {data && !data.bot.secretConfigured && (
        <div className="notice">
          <b>CROWN_BOT_SECRET isn&apos;t set on the server.</b> The bot pipe is fail-closed, so the bot cannot connect at all —
          set the same value in <code>.env.local</code> and <code>bot/.env</code>.
        </div>
      )}
      {data?.queue.lastError && (
        <div className="notice">
          <b>Last delivery error:</b> {data.queue.lastError}
        </div>
      )}

      {/* ---- who's connected ---- */}
      {!error && (
      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>Connected chats</h2>
            <div className="ph-sub">Pages that will receive notifications.</div>
          </div>
        </div>
        {data?.links.length ? (
          <table className="otable">
            <thead>
              <tr>
                <th>Page</th>
                <th>Telegram</th>
                <th>Categories on</th>
                <th>Monthly</th>
              </tr>
            </thead>
            <tbody>
              {data.links.map((l) => (
                <tr key={l.handle}>
                  <td>
                    <div className="who-cell">
                      <span className="h">{l.name}</span>
                      <span className="n">@{l.handle}</span>
                    </div>
                  </td>
                  <td>{l.tgName || "—"}</td>
                  <td>
                    {ORDER.filter((u) => l.categories?.[u]).map((u) => URGENCY_LABEL[u]).join(", ") || "none"}
                  </td>
                  <td>{l.monthly ? "on" : "off"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="footnote">Nobody has connected Telegram yet.</p>
        )}
      </div>
      )}

      {/* ---- test controls ---- */}
      {!error && (
      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>Test a scenario</h2>
            <div className="ph-sub">Sends the real thing — same queue, same card, same filtering.</div>
          </div>
        </div>
        <div className={styles.controls}>
          <label className={styles.field}>
            <span>Send to</span>
            <select value={target} onChange={(e) => setTarget(e.target.value)} disabled={!data?.links.length}>
              {data?.links.length ? (
                data.links.map((l) => (
                  <option key={l.handle} value={l.handle}>
                    {l.name} (@{l.handle})
                  </option>
                ))
              ) : (
                <option value="">no connected chats</option>
              )}
            </select>
          </label>
          <label className={styles.checkbox}>
            <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
            <span>Ignore their settings (preview a switched-off category)</span>
          </label>
        </div>
      </div>
      )}

      {/* ---- scenarios by category ---- */}
      {ORDER.map((urgency) => {
        const list = BOT_SCENARIOS.filter((s) => URGENCY_OF[s.kind] === urgency);
        if (!list.length) return null;
        const isOpen = !!open[urgency];
        const wired = list.filter((s) => s.wired).length;
        return (
          <div className="panel" key={urgency}>
            <button
              type="button"
              className={styles.groupHead}
              aria-expanded={isOpen}
              onClick={() => setOpen((p) => ({ ...p, [urgency]: !p[urgency] }))}
            >
              <svg className={`${styles.chev}${isOpen ? ` ${styles.chevOpen}` : ""}`} width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className={styles.groupTitle}>{URGENCY_LABEL[urgency]}</span>
              <span className={styles.groupCount}>
                {wired}/{list.length} live
              </span>
            </button>

            {isOpen && (
              <div className={styles.list}>
                {list.map((s) => (
                  <div className={styles.row} key={s.kind}>
                    <div className={styles.rowMain}>
                      <div className={styles.rowTop}>
                        <span className={styles.rowLabel}>{s.label}</span>
                        {s.wired ? (
                          <span className="pill ok">
                            <span className="dot" />
                            Live
                          </span>
                        ) : (
                          <span className="pill wait">
                            <span className="dot" />
                            Not wired yet
                          </span>
                        )}
                      </div>
                      <div className={styles.when}>{s.when}</div>
                      <div className={styles.sample}>
                        <b>{s.sample.title}</b> — {s.sample.body}
                      </div>
                      <div className={styles.source}>{s.source}</div>
                      {result?.kind === s.kind && (
                        <div className={result.ok ? styles.okNote : "error-note"}>{result.text}</div>
                      )}
                    </div>
                    <button
                      type="button"
                      className="btn-outline"
                      disabled={!target || sending === s.kind}
                      onClick={() => void sendTest(s)}
                    >
                      {sending === s.kind ? "Sending…" : "Send test"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
