"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { URGENCY_LABEL, type NotifUrgency } from "@/lib/data/notifications";
import { useSolanaWallet } from "@/lib/chain/wallet";
import { buildAuthMessage } from "@/lib/chain/authMessage";
import styles from "./TelegramPanel.module.css";

// The "Telegram" cabinet section (its own sidebar tab under Bot): connect the notification bot,
// choose what arrives, test it, disconnect.
// Talks only to our own /api/telegram/* on localhost — the bot process does the Telegram side.

type Status = {
  botUsername: string | null;
  linked: boolean;
  tgName: string | null;
  categories: Record<NotifUrgency, boolean> | null;
  monthly: boolean | null;
};

const CATEGORY_HINT: Record<NotifUrgency, string> = {
  action: "New tasks, deadlines, rounds closing — things that cost money if missed.",
  money: "Payouts landed, refunds went out.",
  nice: "Donations, rank-ups, records.",
  digest: "Stream and week summaries.",
  system: "A payout failed, something needs fixing.",
};

export function TelegramPanel({ handle, name }: { handle: string; name: string }) {
  const wallet = useSolanaWallet();
  const [status, setStatus] = useState<Status | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [actionError, setActionError] = useState("");
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [testSent, setTestSent] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Sign a mutating Telegram request with the owner's wallet — the server requires the page
  // owner's signature to touch a real page's link/prefs/notifications. On a demo page (no owner)
  // the signature is absent and the server allows it, so the wallet-less mock flow still works.
  // The signed body must be byte-identical to what we POST, so callers pass the same object.
  const signedHeaders = useCallback(
    async (action: string, body: unknown): Promise<Record<string, string>> => {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (wallet.connected && wallet.address) {
        const ts = Math.floor(Date.now() / 1000);
        const sig = await wallet.signMessage(await buildAuthMessage(action, handle, ts, body));
        if (sig) {
          headers["x-crown-pubkey"] = wallet.address;
          headers["x-crown-ts"] = String(ts);
          headers["x-crown-signature"] = Buffer.from(sig).toString("base64");
        }
      }
      return headers;
    },
    [wallet, handle]
  );

  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch(`/api/telegram/status?handle=${encodeURIComponent(handle)}`);
      if (!r.ok) throw new Error(String(r.status));
      const s: Status = await r.json();
      setStatus(s);
      setLoadState("ready");
      return s;
    } catch {
      // Don't blank the whole section on a failed load — show a retry instead. Keep any status we
      // already had so a poll hiccup mid-session doesn't wipe the connected UI.
      setLoadState((prev) => (prev === "ready" ? "ready" : "error"));
      return null;
    }
  }, [handle]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // while the deep link is out there, poll until the bot reports the chat linked
  useEffect(() => {
    if (!waiting) return;
    pollRef.current = setInterval(async () => {
      const s = await fetchStatus();
      if (s?.linked) {
        setWaiting(false);
        setDeepLink(null);
      }
    }, 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [waiting, fetchStatus]);

  async function connect() {
    setActionError("");
    const body = { handle, name };
    try {
      const r = await fetch("/api/telegram/link", {
        method: "POST",
        headers: await signedHeaders("tg-link", body),
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(String(r.status));
      const res = await r.json();
      if (res.deepLink) {
        setDeepLink(res.deepLink);
        setWaiting(true);
        window.open(res.deepLink, "_blank", "noreferrer");
      } else {
        setDeepLink(null);
        setStatus((s) => (s ? { ...s, botUsername: null } : s));
      }
    } catch {
      setActionError("Couldn't reach Telegram. Try again.");
    }
  }

  async function toggle(cat: NotifUrgency) {
    if (!status?.categories) return;
    const prev = status;
    const next = { ...status.categories, [cat]: !status.categories[cat] };
    setStatus({ ...status, categories: next });
    setActionError("");
    const body = { handle, categories: { [cat]: next[cat] } };
    try {
      const r = await fetch("/api/telegram/prefs", { method: "POST", headers: await signedHeaders("tg-prefs", body), body: JSON.stringify(body) });
      if (!r.ok) throw new Error(String(r.status));
    } catch {
      setStatus(prev); // roll the toggle back — the server never saw it
      setActionError("Couldn't save. Try again.");
    }
  }

  async function toggleMonthly() {
    if (!status) return;
    const prev = status;
    const next = !status.monthly;
    setStatus({ ...status, monthly: next });
    setActionError("");
    const body = { handle, monthly: next };
    try {
      const r = await fetch("/api/telegram/prefs", { method: "POST", headers: await signedHeaders("tg-prefs", body), body: JSON.stringify(body) });
      if (!r.ok) throw new Error(String(r.status));
    } catch {
      setStatus(prev);
      setActionError("Couldn't save. Try again.");
    }
  }

  async function sendTest() {
    setActionError("");
    // NOT forced: the test must travel the same path a real notification does, category toggles and
    // all. Forcing it meant a creator who had switched everything off still saw the test arrive and
    // concluded the bot was working, then heard nothing again.
    const body = { handle, kind: "donation", title: "Test from your space", body: "This is how notifications will look." };
    try {
      const r = await fetch("/api/telegram/notify", { method: "POST", headers: await signedHeaders("tg-notify", body), body: JSON.stringify(body) });
      if (!r.ok) throw new Error(String(r.status));
      const { queued } = (await r.json()) as { queued?: boolean };
      if (!queued) {
        // Filtered by the creator's own toggles — say so, instead of a green tick for a message
        // that will never arrive.
        setActionError("Nothing was sent: the category this test uses is switched off above.");
        return;
      }
      setTestSent(true);
      setTimeout(() => setTestSent(false), 2500);
    } catch {
      setActionError("Couldn't send the test. Try again.");
    }
  }

  async function disconnect() {
    setActionError("");
    const body = { handle };
    try {
      const r = await fetch("/api/telegram/unlink", { method: "POST", headers: await signedHeaders("tg-unlink", body), body: JSON.stringify(body) });
      if (!r.ok) throw new Error(String(r.status));
    } catch {
      setActionError("Couldn't disconnect. Try again.");
    }
    fetchStatus();
  }

  if (loadState === "loading") {
    return (
      <div className="card">
        <h3 className={styles.title}>Telegram</h3>
        <p className={styles.sub}>Loading…</p>
      </div>
    );
  }
  if (loadState === "error" || !status) {
    return (
      <div className="card">
        <h3 className={styles.title}>Telegram</h3>
        <p className={styles.sub}>Couldn&apos;t load your Telegram settings.</p>
        <button className="btn" type="button" onClick={() => { setLoadState("loading"); fetchStatus(); }}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="card">
      <div className={styles.head}>
        <div>
          <h3 className={styles.title}>Telegram</h3>
          <p className={styles.sub}>Everything from the bell, in your pocket. Optional — off until you connect it.</p>
        </div>
        {status.linked && (
          <span className={styles.connected}>
            <span className={styles.connectedDot} aria-hidden />
            Connected{status.tgName ? ` · ${status.tgName}` : ""}
          </span>
        )}
      </div>

      {actionError && <p className={styles.sub} style={{ color: "var(--error)" }}>{actionError}</p>}

      {!status.linked ? (
        status.botUsername ? (
          <div className={styles.connectRow}>
            <button className="btn" type="button" onClick={connect}>
              {waiting ? "Waiting for Telegram…" : "Connect Telegram"}
            </button>
            {waiting && deepLink && (
              <span className={styles.waitNote}>
                Didn&apos;t open?{" "}
                <a href={deepLink} target="_blank" rel="noreferrer">
                  t.me/{status.botUsername}
                </a>{" "}
                — tap Start there.
              </span>
            )}
          </div>
        ) : (
          <p className={styles.offline}>The bot isn&apos;t running. Start it with a token from @BotFather — see bot/README.md.</p>
        )
      ) : (
        <>
          <div className={styles.toggles}>
            {(Object.keys(URGENCY_LABEL) as NotifUrgency[]).map((u) => (
              <label className={styles.toggle} key={u}>
                <input type="checkbox" checked={status.categories?.[u] ?? true} onChange={() => toggle(u)} />
                <span className={styles.toggleBody}>
                  <span className={styles.toggleLabel}>{URGENCY_LABEL[u]}</span>
                  <span className={styles.toggleHint}>{CATEGORY_HINT[u]}</span>
                </span>
              </label>
            ))}
            <label className={styles.toggle}>
              <input type="checkbox" checked={status.monthly ?? true} onChange={toggleMonthly} />
              <span className={styles.toggleBody}>
                <span className={styles.toggleLabel}>Monthly digest</span>
                <span className={styles.toggleHint}>Earned, VIPs gained, best day — one message a month.</span>
              </span>
            </label>
          </div>

          <div className={styles.actions}>
            <button className="btn-outline" type="button" onClick={sendTest}>
              {testSent ? "Sent ✓" : "Send a test"}
            </button>
            <button className={styles.disconnect} type="button" onClick={disconnect}>
              Disconnect
            </button>
          </div>
        </>
      )}
    </div>
  );
}
