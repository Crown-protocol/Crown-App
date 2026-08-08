"use client";

import { useEffect, useRef, useState } from "react";
import { useCheer, NotConfiguredError } from "@/lib/data/DataProvider";
import { useWallet } from "@/lib/chain/useWallet";
import { readDonorName, writeDonorName } from "@/lib/data/donorName";
import { useConfirm } from "@/components/useConfirm";
import { dangerCopy } from "@/lib/data/dangerous";
import { usd } from "@/lib/money";

type Status = "idle" | "sending" | "done" | "error";

const DEFAULT_PRESETS = [1, 5, 10];

function short(addr?: string) {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "";
}

function friendlyError(e: unknown): { text: string; soft: boolean } {
  if (e instanceof NotConfiguredError) return { text: e.message, soft: false };
  const msg = e instanceof Error ? e.message : String(e);
  if (/rejected|denied|declined|cancel/i.test(msg)) return { text: "", soft: true }; // user closed the wallet — not an error
  // Solana wallets phrase an empty USDC account several ways; SOL covers tx fees.
  if (/insufficient|custom program error: 0x1\b|InsufficientFunds/i.test(msg)) return { text: "Not enough USDC in the wallet.", soft: false };
  // "No USDC", not "no devnet USDC": which network the app runs on is our business, not the donor's,
  // and the sentence has to stay true after the mainnet cutover. The one place that DOES name the
  // network is /wallet-guide, where saying "this isn't real money yet" is the honest thing to do.
  if (/could not find account|AccountNotFound/i.test(msg)) return { text: "No USDC in this wallet yet.", soft: false };
  if (/connect.*wallet/i.test(msg)) return { text: "Connect your wallet first.", soft: false };
  return { text: "Something went wrong. Try again.", soft: false };
}

export function DonateForm({
  handle,
  defaultAmount = 5,
  streamerName = "the content maker's wallet",
  presets = DEFAULT_PRESETS,
  slug,
}: {
  handle: string;
  defaultAmount?: number;
  streamerName?: string;
  presets?: number[];
  slug?: string; // campaign page passes its slug so only that campaign's total is bumped
}) {
  const { mode, donate } = useCheer();
  const wallet = useWallet();
  const confirm = useConfirm(); // a donation leaves the wallet for good — never on one click
  const PRESETS = presets.length ? presets : DEFAULT_PRESETS;

  // Open on a real preset. If defaultAmount isn't one of this streamer's presets, fall back to a
  // middle preset instead of opening the "custom" input (which read as broken with custom presets).
  const initialAmount = PRESETS.includes(defaultAmount) ? defaultAmount : PRESETS[Math.min(1, PRESETS.length - 1)];
  const [amount, setAmount] = useState(initialAmount);
  const [activePreset, setActivePreset] = useState<number | "custom">(initialAmount);
  const [customOpen, setCustomOpen] = useState(false);
  const [customValue, setCustomValue] = useState("");
  const lastPreset = useRef<number>(initialAmount);

  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");

  // Prefill the name the viewer saved on /me (or used on their last donation) — read after mount,
  // localStorage doesn't exist during SSR. Still editable per-donation.
  useEffect(() => {
    const saved = readDonorName();
    if (saved) setName(saved);
  }, []);

  const busy = status === "sending";
  // A submit must not re-fire while the request is in flight OR during the 2s "Done" window that
  // follows a success (the button stays visible and would otherwise send a duplicate donation).
  // "error" is intentionally excluded — the button reverts to "Cheer" so the donor can retry.
  const locked = status === "sending" || status === "done";
  const chainNeedsConnect = mode === "chain" && !wallet.connected;

  // Reset timers are stored so they can't fire setState after unmount or stack up across submits.
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleIdle = (ms: number) => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setStatus("idle"), ms);
  };
  useEffect(() => () => { if (resetTimer.current) clearTimeout(resetTimer.current); }, []);

  function pickPreset(p: number) {
    setActivePreset(p);
    setAmount(p);
    lastPreset.current = p;
    setCustomOpen(false);
    setCustomValue("");
  }

  function openCustom() {
    setActivePreset("custom");
    setCustomOpen(true);
  }

  function onCustomBlur() {
    if (!customValue) {
      setActivePreset(lastPreset.current);
      setAmount(lastPreset.current);
      setCustomOpen(false);
    } else {
      // Show the rounded whole-dollar value that will actually be donated (no "10.5 shown, 11 sent").
      setCustomValue(String(amount));
    }
  }

  async function onSubmit() {
    if (locked) return;
    setError("");

    if (chainNeedsConnect) {
      if (wallet.connecting) return; // a connect popup is already open — don't stack a second one
      if (!wallet.hasWallet) {
        setError("No Solana wallet found in the browser. Install Phantom or Solflare.");
        return;
      }
      wallet.connect();
      return;
    }

    // Everything above is preamble (connecting a wallet, telling them they don't have one). THIS is
    // the point of no return, so the confirmation sits here rather than on the button: the same
    // click can mean "connect" or "send $50", and only the second one deserves a stop.
    confirm(dangerCopy.donate(amount), () => send());
  }

  async function send() {
    setStatus("sending");
    try {
      await donate({ handle, amount, name, message, slug }, wallet.address);
      // Remember the name they donated under, so the next form (any maker) starts prefilled.
      if (name.trim()) writeDonorName(name);
      setStatus("done");
      setName(readDonorName());
      setMessage("");
      scheduleIdle(2000);
    } catch (e) {
      const { text, soft } = friendlyError(e);
      if (soft) {
        setStatus("idle");
      } else {
        setStatus("error");
        setError(text);
        scheduleIdle(10000);
      }
    }
  }

  let label: React.ReactNode;
  if (busy) label = "Sending…";
  else if (status === "done") label = "Done";
  else if (chainNeedsConnect) label = wallet.connecting ? "Opening wallet…" : "Connect wallet";
  else label = (<>Cheer <span className="num">{usd(amount)}</span></>);

  return (
    <div className="card form-card">
      <div className="chips" role="group" aria-label="Donation amount">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            className={`chip num${activePreset === p ? " active" : ""}`}
            disabled={busy}
            onClick={() => pickPreset(p)}
          >
            {usd(p)}
          </button>
        ))}
        {customOpen ? (
          <span className={`chip${activePreset === "custom" ? " active" : ""}`}>
            <input
              type="number"
              min={1}
              autoFocus
              placeholder="$"
              aria-label="Custom amount"
              value={customValue}
              disabled={busy}
              onChange={(e) => {
                const raw = e.target.value;
                setCustomValue(raw);
                setActivePreset("custom");
                // Keep the amount that will actually be sent in step with the field: empty or
                // rounds-to-zero ("0", "0.4", "-2", junk) means "no real amount yet", so DON'T quietly
                // arm a $1 charge behind it. amount only moves to a real dollar figure once one is typed;
                // onCustomBlur then snaps the display to match, so a stray "0" can never send $1.
                const n = Math.round(+raw);
                if (raw && Number.isFinite(n) && n >= 1) setAmount(n);
              }}
              onBlur={onCustomBlur}
            />
          </span>
        ) : (
          <button type="button" className="chip" disabled={busy} onClick={openCustom}>
            Custom
          </button>
        )}
      </div>

      <div className="field">
        <label htmlFor="don-name">Your name</label>
        <input id="don-name" type="text" placeholder="optional" value={name} disabled={busy} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="don-msg">Message</label>
        <textarea id="don-msg" rows={2} placeholder="optional" value={message} disabled={busy} onChange={(e) => setMessage(e.target.value)} />
      </div>

      <button type="button" className="btn" disabled={locked || wallet.connecting} onClick={onSubmit}>
        {label}
      </button>

      {error ? (
        <div className="footnote" style={{ color: "var(--error)" }}>
          {error}
        </div>
      ) : (
        <div className="footnote">
          Dollars (USDC) · arrive at {streamerName} directly
          {mode === "chain" && wallet.connected ? ` · ${short(wallet.address)}` : ""}
        </div>
      )}
      {confirm.dialog}
    </div>
  );
}
