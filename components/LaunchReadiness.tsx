"use client";

import { useEffect, useState } from "react";
import {
  CHAIN_ID,
  RPC_URL,
  SPLITTER,
  USDC_MINT,
  FACTORY_TWO_OUTCOME,
  FACTORY_PAYOUT_TABLE,
  FACTORY_STREAM,
  FEE_WALLET,
  IC_HOST,
  CHEER_INDEX_PRINCIPAL,
  TASKS_PRINCIPAL,
  FUNDING_PRINCIPAL,
  AUCTION_PRINCIPAL,
  SUBSCRIPTION_PRINCIPAL,
  isIndexConfigured,
} from "@/lib/chain/config";

// Launch readiness — the one screen that answers "what's missing before we go live".
// Every row is a real switch: a green pill means the piece is configured RIGHT NOW in this
// build; an amber one names the exact env var that turns it on. No deploy scripts here —
// flipping env and rebuilding IS the launch procedure (chain ids are baked at build time).

type State = "on" | "off" | "checking";

interface Row {
  name: string;
  detail: string; // what's configured, or the env var that would configure it
  state: State;
  note?: string;
}

const short = (a: string) => (a.length > 20 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a);

function Pill({ state }: { state: State }) {
  const cls = state === "on" ? "ok" : state === "checking" ? "wait" : "attn";
  const word = state === "on" ? "ready" : state === "checking" ? "checking" : "waiting";
  return (
    <span className={`pill ${cls}`}>
      <span className="dot" />
      {word}
    </span>
  );
}

export function LaunchReadiness() {
  // Server-side pieces get probed live; chain config is baked into the bundle.
  const [db, setDb] = useState<State>("checking");
  const [dbNote, setDbNote] = useState("");
  const [bot, setBot] = useState<State>("checking");
  const [botNote, setBotNote] = useState("");

  useEffect(() => {
    void fetch("/api/health")
      .then(async (r) => {
        const j = await r.json();
        setDb(j?.ok ? "on" : "off");
        setDbNote(j?.ok ? `${j.db?.profiles ?? 0} profiles · ${j.db?.donations ?? 0} donations mirrored` : "DB unreachable");
      })
      .catch(() => {
        setDb("off");
        setDbNote("API unreachable");
      });
    void fetch("/api/telegram/status")
      .then(async (r) => {
        const j = await r.json();
        // `botRunning` is the live heartbeat; `botUsername` only means the bot introduced itself
        // once, possibly months ago. Reading the latter reported "on" for a bot that had been down
        // for days — which is the one thing a readiness check must never do.
        setBot(j?.botRunning ? "on" : "off");
        setBotNote(
          j?.botRunning
            ? `@${j.botUsername ?? "bot"} — running`
            : j?.botUsername
              ? `@${j.botUsername} configured but not responding — start the bot (bot/README.md)`
              : "start the bot (bot/README.md) — TELEGRAM_BOT_TOKEN"
        );
      })
      .catch(() => {
        setBot("off");
        setBotNote("API unreachable");
      });
  }, []);

  const groups: { title: string; rows: Row[] }[] = [
    {
      title: "Money rails (Solana)",
      rows: [
        { name: "Network", detail: `${CHAIN_ID} · ${RPC_URL}`, state: "on", note: "mainnet = NEXT_PUBLIC_CHAIN_ID + NEXT_PUBLIC_SOLANA_RPC" },
        { name: "Splitter (donations)", detail: short(SPLITTER.toBase58()), state: "on", note: "NEXT_PUBLIC_SPLITTER" },
        { name: "USDC mint", detail: short(USDC_MINT.toBase58()), state: "on", note: "NEXT_PUBLIC_USDC_MINT" },
        { name: "Two-outcome factory (game escrows)", detail: short(FACTORY_TWO_OUTCOME.toBase58()), state: "on", note: "NEXT_PUBLIC_FACTORY_TWO_OUTCOME" },
        { name: "Payout-table factory", detail: short(FACTORY_PAYOUT_TABLE.toBase58()), state: "on", note: "NEXT_PUBLIC_FACTORY_PAYOUT_TABLE" },
        { name: "Stream factory (subscriptions)", detail: short(FACTORY_STREAM.toBase58()), state: "on", note: "NEXT_PUBLIC_FACTORY_STREAM" },
        { name: "Fee wallet", detail: short(FEE_WALLET.toBase58()), state: "on", note: "NEXT_PUBLIC_FEE_WALLET" },
      ],
    },
    {
      title: "Resolvers (ICP canisters)",
      rows: [
        { name: "IC gateway", detail: IC_HOST || "NEXT_PUBLIC_IC_HOST", state: IC_HOST ? "on" : "off" },
        { name: "cheer-index (reputation book)", detail: CHEER_INDEX_PRINCIPAL || "NEXT_PUBLIC_CHEER_INDEX_PRINCIPAL", state: isIndexConfigured() ? "on" : "off", note: "until then the DB mirror serves /api/reputation" },
        { name: "Conditional-Tasks", detail: TASKS_PRINCIPAL || "NEXT_PUBLIC_TASKS_PRINCIPAL", state: TASKS_PRINCIPAL ? "on" : "off", note: "task escrows go live the moment this lands" },
        { name: "Conditional-Funding", detail: FUNDING_PRINCIPAL || "NEXT_PUBLIC_FUNDING_PRINCIPAL", state: FUNDING_PRINCIPAL ? "on" : "off", note: "fundraiser collections go live" },
        { name: "Auction", detail: AUCTION_PRINCIPAL || "NEXT_PUBLIC_AUCTION_PRINCIPAL", state: AUCTION_PRINCIPAL ? "on" : "off", note: "auction lots go live" },
        { name: "Subscription", detail: SUBSCRIPTION_PRINCIPAL || "NEXT_PUBLIC_SUBSCRIPTION_PRINCIPAL", state: SUBSCRIPTION_PRINCIPAL ? "on" : "off", note: "client ready; the game has no UI yet" },
      ],
    },
    {
      title: "Our own backend",
      rows: [
        { name: "Cheer DB + API", detail: dbNote || "…", state: db },
        { name: "Telegram bot", detail: botNote || "…", state: bot },
        { name: "Default visitor mode", detail: process.env.NEXT_PUBLIC_DEFAULT_MODE === "chain" ? "chain (real money)" : "mock (demo)", state: process.env.NEXT_PUBLIC_DEFAULT_MODE === "chain" ? "on" : "off", note: "NEXT_PUBLIC_DEFAULT_MODE — .env.production pins chain" },
      ],
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div className="footnote">
        Green = configured in this build. Amber = the named env var is the switch; set it and rebuild — no code changes.
      </div>
      {groups.map((g) => (
        <div className="card" key={g.title} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h3 style={{ fontSize: 15 }}>{g.title}</h3>
          {g.rows.map((r) => (
            <div key={r.name} style={{ display: "flex", alignItems: "baseline", gap: 12, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
              <div style={{ minWidth: 250, fontWeight: 600 }}>{r.name}</div>
              <div className="num" style={{ flex: 1, color: "var(--text-2)", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.detail}>
                {r.detail}
              </div>
              {r.note && <div className="footnote" style={{ maxWidth: 320 }}>{r.note}</div>}
              <Pill state={r.state} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
