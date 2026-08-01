import type { NotifKind, NotifUrgency } from "./notifications";

// Every message the bot can send, with the condition that triggers it in production. This is the
// admin panel's map of the bot: what exists, when it fires, and whether it's actually wired up yet —
// so "does the bot tell me about X?" has an answer you can read instead of guess.
//
// `wired` is deliberately honest: false means the notification type exists but nothing in the
// product emits it yet. Showing them anyway is the point — that list IS the remaining work.

export interface BotScenario {
  kind: NotifKind;
  label: string; // what it is, in the creator's words
  when: string; // the exact condition that fires it in production
  source: string; // where it comes from, so a developer can find it
  wired: boolean; // does anything actually emit this today?
  sample: { title: string; body: string }; // what the test sends
}

export const BOT_SCENARIOS: BotScenario[] = [
  // ── Needs you ─────────────────────────────────────────────────────────────
  {
    kind: "task_offered",
    label: "A viewer set you a paid task",
    when: "A viewer submits a task on your task page (the money goes into escrow).",
    source: "game-notify · crown-tasks/append",
    wired: true,
    sample: { title: "A task for $50", body: "toffi asked: Beat the boss with no armor. Approve it in your space to start the clock." },
  },
  {
    kind: "task_deadline_soon",
    label: "A task's deadline is close",
    when: "A quarter of the task's window is left (checked every 10 minutes).",
    source: "telegram-scheduler · checkTaskDeadlines",
    wired: true,
    sample: { title: "6h left on a $50 task", body: "\"Beat the boss with no armor\" — finish it before the window closes." },
  },
  {
    kind: "task_expiring",
    label: "A task's deadline has passed",
    when: "The window closed and the task is still unfinished — refund territory.",
    source: "telegram-scheduler · checkTaskDeadlines",
    wired: true,
    sample: { title: "Deadline passed — $50", body: "\"Beat the boss with no armor\" is past its window. Finish it or refund the viewer." },
  },
  {
    kind: "auction_lot_offered",
    label: "Someone bid on your auction",
    when: "A viewer places a lot on your auction page.",
    source: "game-notify · crown-auction-lots/append",
    wired: true,
    sample: { title: "New lot — $60", body: "anna bid on: Finish the map on the hardest difficulty." },
  },
  {
    kind: "auction_closing",
    label: "Auction closed — deliver the winning lot",
    when: "Bidding ends and the auction moves to delivery.",
    source: "game-notify · crown-auction-meta → performing",
    wired: true,
    sample: { title: "Auction closed", body: "The winning lot is yours to deliver — open your space for the details." },
  },
  {
    kind: "fundraiser_goal_hit",
    label: "Fundraiser accepted — delivery started",
    when: "You accept the collected amount and the delivery window opens.",
    source: "game-notify · crown-fundraiser-status → delivering",
    wired: true,
    sample: { title: "Fundraiser accepted — $500", body: "Your delivery window has started. Deliver in time or everyone is refunded." },
  },
  {
    kind: "roulette_closing",
    label: "Roulette round is about to close",
    when: "The submission window is nearly over.",
    source: "not emitted yet",
    wired: false,
    sample: { title: "Your roulette round closes in 12m", body: "$1,600 in the pot, 3 picks suggested." },
  },
  {
    kind: "fundraiser_delivery_due",
    label: "Fundraiser delivery is due",
    when: "The delivery window is nearly over and nothing is marked delivered.",
    source: "not emitted yet",
    wired: false,
    sample: { title: "Delivery due in 1 day", body: "Mark it delivered, or every backer is refunded." },
  },
  {
    kind: "vote_started",
    label: "A vote started",
    when: "Reputation holders begin voting on a delivery.",
    source: "not emitted yet",
    wired: false,
    sample: { title: "Your backers are voting", body: "They're confirming whether the promise was delivered." },
  },

  // ── Money ─────────────────────────────────────────────────────────────────
  {
    kind: "payout",
    label: "Money landed in your wallet",
    when: "An auction settles, or a fundraiser is marked delivered.",
    source: "game-notify · auction/fundraiser settle",
    wired: true,
    sample: { title: "Auction settled", body: "The money is on its way to your wallet." },
  },
  {
    kind: "task_refunded",
    label: "A task was refunded",
    when: "You decline a task, or refund one you accepted.",
    source: "game-notify · crown-tasks/entry → refunded",
    wired: true,
    sample: { title: "Task refunded — $50", body: "\"Beat the boss with no armor\" went back to the viewer." },
  },
  {
    kind: "fundraiser_refunded",
    label: "A fundraiser was refunded",
    when: "The fundraiser is refunded — every backer gets their money back.",
    source: "game-notify · crown-fundraiser-status → refunded",
    wired: true,
    sample: { title: "Fundraiser refunded", body: "Everyone got their money back." },
  },
  {
    kind: "roulette_settled",
    label: "The wheel picked a winner",
    when: "A roulette round closes with a verdict.",
    source: "game-notify · crown-roulette-meta → winner",
    wired: true,
    sample: { title: "The wheel picked \"Elden Ring\"", body: "Round closed — that's what you're on the hook for." },
  },
  {
    kind: "auction_settled",
    label: "Auction settled",
    when: "The auction's escrow pays out.",
    source: "not emitted yet (payout covers it today)",
    wired: false,
    sample: { title: "Auction settled — $600", body: "The winning lot has been paid out." },
  },

  // ── Good news ─────────────────────────────────────────────────────────────
  {
    kind: "donation",
    label: "A donation arrived",
    when: "The indexer sees a settled donation on-chain. Also fundraiser chip-ins and roulette backing.",
    source: "indexer · Settled events",
    wired: true,
    sample: { title: "A donation arrived — $25", body: "It's already in your wallet." },
  },
  {
    kind: "big_donation",
    label: "An unusually large donation",
    when: "A donation well above your usual size.",
    source: "not emitted yet",
    wired: false,
    sample: { title: "toffi donated $250", body: "Your biggest this month." },
  },
  {
    kind: "rank_up",
    label: "A viewer reached a new tier",
    when: "Someone's reputation crosses one of your tier thresholds.",
    source: "not emitted yet",
    wired: false,
    sample: { title: "anna reached Gold", body: "She's crossed 500 reputation with you." },
  },
  {
    kind: "first_donation",
    label: "Someone's first donation to you",
    when: "A wallet backs you for the first time.",
    source: "not emitted yet",
    wired: false,
    sample: { title: "A new supporter", body: "toffi backed you for the first time — $10." },
  },
  {
    kind: "record",
    label: "A record was broken",
    when: "Your best day, week or single donation is beaten.",
    source: "not emitted yet",
    wired: false,
    sample: { title: "Best day yet — $340", body: "Your strongest day on Crown so far." },
  },

  // ── Summaries ─────────────────────────────────────────────────────────────
  {
    kind: "stream_summary",
    label: "Monthly digest",
    when: "The 1st of each month, only if the month had donations.",
    source: "telegram-scheduler · sendMonthlyDigests",
    wired: true,
    sample: { title: "Your month on Crown", body: "Earned $1,240 from 38 donations." },
  },
  {
    kind: "week_summary",
    label: "Weekly summary",
    when: "A short weekly recap.",
    source: "not emitted yet",
    wired: false,
    sample: { title: "Your week", body: "$420 from 14 donations." },
  },

  // ── Problems ──────────────────────────────────────────────────────────────
  {
    kind: "wallet_problem",
    label: "Something's wrong with your payout wallet",
    when: "Donations can't reach the address on your page.",
    source: "not emitted yet",
    wired: false,
    sample: { title: "Payouts are failing", body: "Check the wallet address in Settings — donations can't land." },
  },
  {
    kind: "game_disabled",
    label: "A mini-game was switched off",
    when: "A game stops accepting entries — by you, or by a problem.",
    source: "not emitted yet",
    wired: false,
    sample: { title: "Your roulette is off", body: "Viewers can't suggest anything until you turn it back on." },
  },
];

export function scenariosByUrgency(urgency: NotifUrgency, urgencyOf: Record<NotifKind, NotifUrgency>): BotScenario[] {
  return BOT_SCENARIOS.filter((s) => urgencyOf[s.kind] === urgency);
}
