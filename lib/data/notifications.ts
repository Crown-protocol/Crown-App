// Notifications for the streamer — data and rules only, no React, so the bell, a future settings
// panel and (later) the real backend feed all agree on what a notification is.
//
// Urgency is the whole design here. Everything that can cost the streamer money is "action";
// everything else must never be allowed to bury it. Only "action" may ever push (front.md §4:
// the front promises nothing it can't keep — a notification that money "will" arrive is a lie,
// one that says it HAS arrived is a fact).

export type NotifUrgency =
  | "action" // needs a decision or money is lost — the only kind allowed to push
  | "money" // money moved, in or out — a fact, after the fact
  | "nice" // pleasant, never urgent — bell only
  | "digest" // periodic summary
  | "system"; // something is broken and needs fixing

export type NotifKind =
  // action
  | "task_offered"
  | "task_deadline_soon"
  | "task_expiring"
  | "roulette_closing"
  | "fundraiser_goal_hit"
  | "fundraiser_delivery_due"
  | "vote_started"
  // money
  | "payout"
  | "task_refunded"
  | "fundraiser_refunded"
  | "roulette_settled"
  // nice
  | "donation"
  | "big_donation"
  | "rank_up"
  | "first_donation"
  | "record"
  // digest
  | "stream_summary"
  | "week_summary"
  // system
  | "wallet_problem"
  | "game_disabled";

export interface Notif {
  id: string;
  kind: NotifKind;
  urgency: NotifUrgency;
  title: string;
  body: string;
  at: number; // ms since epoch
  read: boolean;
  href?: string; // where the notification takes you — the cabinet section that acts on it
  amount?: number; // shown as a figure when the notification is about money
  deadline?: number; // ms since epoch — renders as a live countdown
}

export const URGENCY_OF: Record<NotifKind, NotifUrgency> = {
  task_offered: "action",
  task_deadline_soon: "action",
  task_expiring: "action",
  roulette_closing: "action",
  fundraiser_goal_hit: "action",
  fundraiser_delivery_due: "action",
  vote_started: "action",
  payout: "money",
  task_refunded: "money",
  fundraiser_refunded: "money",
  roulette_settled: "money",
  donation: "nice",
  big_donation: "nice",
  rank_up: "nice",
  first_donation: "nice",
  record: "nice",
  stream_summary: "digest",
  week_summary: "digest",
  wallet_problem: "system",
  game_disabled: "system",
};

// Group labels for the bell. Kept short — the list is scanned, not read.
export const URGENCY_LABEL: Record<NotifUrgency, string> = {
  action: "Needs you",
  money: "Money",
  nice: "Good news",
  digest: "Summary",
  system: "Fix this",
};

export function isActionable(n: Notif) {
  return URGENCY_OF[n.kind] === "action";
}

// "in 4h 20m" / "in 12m" / "expired" — a deadline is only useful as time remaining.
export function timeLeft(deadline: number, now: number): string {
  const ms = deadline - now;
  if (ms <= 0) return "expired";
  const mins = Math.floor(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h >= 24) return `in ${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `in ${h}h ${m}m`;
  return `in ${m}m`;
}

// "2m ago" / "3h ago" / "yesterday"
export function timeAgo(at: number, now: number): string {
  const mins = Math.floor((now - at) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d}d ago`;
}

// The bell starts empty and fills from what actually happens: donations arrive
// live over the donation stream, game events through the notify endpoints. The
// sample feed that used to seed it — one row of every kind, with amounts — is
// gone; a creator counting money they had not been paid is exactly the harm the
// rest of this cleanup was about.
export function seedNotifications(_now: number): Notif[] {
  return [];
}
