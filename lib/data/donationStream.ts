// Real-time transport for donation events, site → OBS overlay. The overlay runs in a SEPARATE browser
// context (OBS Browser Source), so it can't share React state with the site. BroadcastChannel carries
// each donation across tabs of the same browser — enough for a streamer testing overlays on their own
// machine. This is the mock/demo source; on `chain` the same events will come from `Settled` logs
// (front.md §2, F4) and overlays won't change — they just subscribe here.

export interface DonationEvent {
  handle: string; // streamer handle, without "@"
  from: string; // donor name
  amount: number; // dollars
  message?: string;
  ts: number; // Date.now() at publish
}

const CHANNEL = "cheer-donations";

function norm(handle: string): string {
  return handle.replace(/^@/, "").toLowerCase();
}

// One long-lived sender channel. Do NOT open+postMessage+close per event: close() cancels the
// still-pending async delivery, so the message never arrives (this bit us — demo alerts vanished).
let sender: BroadcastChannel | null = null;
function getSender(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  if (!sender) {
    try {
      sender = new BroadcastChannel(CHANNEL);
    } catch {
      return null;
    }
  }
  return sender;
}

export function publishDonation(e: DonationEvent): void {
  const ch = getSender();
  if (!ch) return; // unsupported — overlays fall back to their own demo tick
  try {
    ch.postMessage({ ...e, handle: norm(e.handle) });
  } catch {}
}

export function subscribeDonations(handle: string, cb: (e: DonationEvent) => void): () => void {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return () => {};
  let bc: BroadcastChannel;
  try {
    bc = new BroadcastChannel(CHANNEL);
  } catch {
    return () => {};
  }
  const target = norm(handle);
  const handler = (ev: MessageEvent<DonationEvent>) => {
    const d = ev.data;
    if (d && norm(d.handle) === target) cb(d);
  };
  bc.addEventListener("message", handler);
  return () => {
    bc.removeEventListener("message", handler);
    bc.close();
  };
}

// ---- Demo generator: fabricate donations so an overlay is lively in OBS without a real donor.
// Enabled per-overlay via ?demo=1. Publishes through the same channel, so every overlay reacts.
const DEMO_NAMES = ["Timur", "anna_k", "lesya", "Whale", "Julia", "Dan", "Maximus", "Anonymous"];
const DEMO_MESSAGES = ["gg!", "keep it up 🔥", "love the stream", "for the new mic", "<3", "let's go", "first!", ""];
const DEMO_AMOUNTS = [1, 3, 5, 10, 25, 50];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function startDemo(handle: string): () => void {
  if (typeof window === "undefined") return () => {};
  const tick = () => {
    publishDonation({
      handle,
      from: pick(DEMO_NAMES),
      amount: pick(DEMO_AMOUNTS),
      message: pick(DEMO_MESSAGES) || undefined,
      ts: Date.now(),
    });
  };
  const id = window.setInterval(tick, 4500);
  const first = window.setTimeout(tick, 1200);
  return () => {
    window.clearInterval(id);
    window.clearTimeout(first);
  };
}
