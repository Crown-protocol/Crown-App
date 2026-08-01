// Mini-games catalog — data, and only data (no React/logic), so it can be imported anywhere:
// the /games page, the homepage teaser, later — cabinet settings. Adding a game = adding a row here;
// the UI iterates this list instead of hardcoding each game.
//
// Games are a layer on top of donations (front.md §5–6): money and reputation travel the same path,
// the game just sets the moment. None are built yet — all are in "building" status (never surfaced as a label).

export type GameId = "task" | "roulette" | "fundraiser" | "auction";

// building — still under construction: shows only as a dim dot in the cabinet, never as a label.
// available — can be enabled.
export type GameStatus = "building" | "available";

// One knob the streamer owns. Every game page renders these the same way, and the same labels
// appear inside the rules text wrapped in [[…]] — so "what I control" is never guesswork.
export interface GameControl {
  label: string; // the knob's name, e.g. "Minimum amount"
  example: string; // a plausible value, shown in the demo panel, e.g. "$5"
  hint: string; // one short line — what it changes, in plain words
}

// A headline fact about the game — three of these replace the opening wall of prose, so the page
// answers "what's in it for me" before anyone has to read a paragraph.
export interface GamePitch {
  label: string; // the question being answered, e.g. "You get"
  value: string; // the answer, short enough to read at a glance
}

// One "How it works" step on the detail page — a plain-language lead + a supporting line. Three of
// these replace the old wall of rules; kept honest to the real mechanics (config in lib/data/*).
export interface GameStep {
  lead: string; // the step in one line
  sub: string; // the detail under it
}

// One knob the streamer sets, shown in "What you set" with its default value. `value` is the real
// default from the game's config (DEFAULT_*_CONFIG) so the page can't drift from what the app does.
export interface GameKnob {
  label: string;
  value: string; // the default value, e.g. "$10" / "24h"
  hint: string;
}

export interface GameModule {
  id: GameId;
  title: string; // UI name
  tagline: string; // one line — what it is, for the catalog card + the detail hero
  status: GameStatus;
  hasPage?: boolean; // only games with a real detail page resolve at /games/<id>
  coverUrl?: string; // a real screenshot, once one exists; unset falls back to the icon placeholder
  steps?: GameStep[]; // "How it works" — 3 steps, detail page
  knobs?: GameKnob[]; // "What you set" — the streamer's real controls + defaults
  // The full rules of the game, in order — the complete mechanic, drawn from the config + spec.
  // Rendered as a numbered list in /docs under each game.
  playRules?: string[];
  // ── legacy fields (pre-redesign template); kept optional so older imports don't break ──
  pitch?: GamePitch[];
  description?: string;
  howItWorks?: string[];
  rules?: string[];
  controls?: GameControl[];
}

export const GAMES: readonly GameModule[] = [
  {
    id: "task",
    title: "Task for donation",
    tagline: "A viewer pays to set you a task. Do it — the money's yours; miss the deadline — it goes back.",
    status: "building",
    hasPage: true,
    steps: [
      {
        lead: "A viewer pays to set you a task.",
        sub: "A dare, a request, a challenge — whatever you allow, at or above the minimum you set. The money locks in escrow; nobody holds it.",
      },
      {
        lead: "You accept it, then do it on stream.",
        sub: "You read the task first and decide — accept and the countdown starts, or turn it down and the viewer is refunded in full.",
      },
      {
        lead: "Done → it's yours. Missed → it goes back.",
        sub: "Finish before the deadline and the money's yours, plus the viewer earns reputation. Miss it and they're refunded automatically.",
      },
    ],
    knobs: [
      { label: "Minimum amount", value: "$10", hint: "The least a viewer can pay to set you a task." },
      { label: "Longest deadline", value: "24h", hint: "The most time a viewer may give you — from 6 hours up to 1 week." },
      { label: "Accept first", value: "On", hint: "You confirm the task before the clock starts (off = paying starts it)." },
      { label: "Max active tasks", value: "5", hint: "New tasks pause once this many are in progress (1–50)." },
    ],
    playRules: [
      "A viewer pays at least the minimum to set a task — the money locks in escrow, held by nobody.",
      "With approval on, you read the task first and accept or decline it; decline and they're refunded in full.",
      "Once accepted, a countdown runs — the viewer picks the deadline, up to your longest allowed.",
      "Finish before the deadline and the money is yours, plus the viewer earns reputation for the amount.",
      "Miss it and the money is refunded to them automatically, on-chain.",
      "New tasks pause once your cap of active tasks is reached, so the queue stays doable.",
    ],
  },
  {
    id: "roulette",
    title: "Roulette",
    tagline: "Viewers back what you do next by donating to it. The wheel spins weighted by the pot — bigger pool, better odds.",
    status: "building",
    hasPage: true,
    steps: [
      {
        lead: "Viewers back a pick by donating to it.",
        sub: "A game, a film, a track — whatever your wheel is about. You set the topic and the minimum; they suggest within it.",
      },
      {
        lead: "Money stacks on the same pick.",
        sub: "Back the same pick and its pool grows — its odds are its share of the pot. No ranking, no jury; the money decides.",
      },
      {
        lead: "The wheel spins. You do the winner.",
        sub: "One spin picks it — or an elimination round, where the money protects the best-backed pick. Losing donations stay donated.",
      },
    ],
    knobs: [
      { label: "Topic", value: "Games", hint: "Games, films & series, music, food, challenges, talk topics, creative work — or your own." },
      { label: "Allowed categories", value: "All", hint: "Restrict suggestions to certain categories, or leave it open to all of them." },
      { label: "Who can suggest", value: "Everyone", hint: "Everyone, or a minimum tier — and you can leave your top tier out." },
      { label: "Minimum to suggest", value: "$5", hint: "The least a viewer donates to put a pick on the wheel." },
      { label: "Round length", value: "30 min", hint: "How long suggestions stay open before the spin — from 5 minutes to 2 hours." },
      { label: "Play time", value: "1 hour", hint: "How long you commit to whatever wins — from 30 minutes to 5 hours." },
      { label: "Spin format", value: "Single", hint: "One spin picks the winner, or an elimination round that knocks picks out one by one." },
    ],
    playRules: [
      "Viewers suggest within your topic by donating at least the minimum; a tier gate can limit who joins.",
      "Backing the same pick grows its pool — its odds are its share of the pot, nothing else. No ranking, no jury.",
      "The round stays open for the round length, or until you close it yourself.",
      "Single format: one weighted spin picks the winner. Elimination: repeated spins knock picks out, and the money protects the best-backed one.",
      "You play the winner for the play time you committed to.",
      "Every suggestion is a plain donation — money on the picks that lose isn't refunded.",
    ],
  },
  {
    id: "fundraiser",
    title: "Fundraiser",
    tagline: "Viewers chip in toward a goal. Deliver it — the pot's yours; don't — everyone's refunded to the cent.",
    status: "building",
    hasPage: true,
    steps: [
      {
        lead: "You open a goal with a promise.",
        sub: "\"If we reach this, I'll do this.\" Viewers chip in from your minimum up — each contribution locks in its own escrow.",
      },
      {
        lead: "The total grows in the open.",
        sub: "When you're ready you accept the amount — the full goal, or a partial one if you allow it (down to a floor you set).",
      },
      {
        lead: "Deliver in the window, or refund.",
        sub: "Deliver and your reputation holders confirm it → the pot's yours, backers earn reputation. Don't → everyone's refunded, even if the goal was met.",
      },
    ],
    knobs: [
      { label: "Minimum chip-in", value: "$1", hint: "The least a single contribution can be." },
      { label: "Collection runs for", value: "14 days", hint: "How long viewers can chip in before it closes — from 1 day to 30 days." },
      { label: "Time to deliver", value: "30 days", hint: "Your window to deliver after you accept — from 1 week to 90 days." },
      { label: "Accept below goal", value: "On, from 50%", hint: "Allow closing on a partial goal, but no lower than the share you set." },
    ],
    playRules: [
      "You open a goal with a promise; viewers chip in from the minimum up, each into its own escrow.",
      "The total grows in the open the whole time — nobody holds the money.",
      "You accept the full goal — or a partial amount, if you allow it, down to your minimum share.",
      "Deliver within the delivery window, and your reputation holders confirm whether you did.",
      "Confirmed: the pot is yours and every backer earns reputation for exactly what they put in.",
      "Not delivered, or not confirmed: everyone is refunded to the cent — even if the goal was met.",
    ],
  },
  {
    id: "auction",
    title: "Auction",
    tagline: "Viewers bid tasks with money. The richest lot you accept wins your time — every other bid is refunded.",
    status: "building",
    hasPage: true,
    steps: [
      {
        lead: "A viewer places a lot.",
        sub: "Money in escrow plus a condition only you can read. Accept the lots you'll do — they go public into the bidding; turn one down and it's refunded.",
      },
      {
        lead: "Lots climb the board.",
        sub: "Anyone can top up an accepted lot — beat the leader by at least your outbid step, and it moves up. The richest lot leads.",
      },
      {
        lead: "The bell rings. Top lot wins.",
        sub: "The richest accepted lot wins; every other lot is refunded on the spot. Deliver the condition in your window → the money's yours; miss it → refunded.",
      },
    ],
    knobs: [
      { label: "Minimum bid", value: "$5", hint: "The least a single bid can put into a lot." },
      { label: "Minimum outbid step", value: "$1", hint: "The least a viewer must beat the current leader by." },
      { label: "Bidding window", value: "24h", hint: "How long viewers can place and top up lots — from 6 hours to 1 week." },
      { label: "Time to deliver", value: "48h", hint: "Your window to do the winning condition after the bell — from 24 hours up." },
    ],
    playRules: [
      "A viewer places a lot: at least the minimum bid in escrow, plus a condition only you can read.",
      "You accept the lots you'll do — accepted texts go public into the bidding; decline and the money goes back.",
      "Anyone can top up an accepted lot, beating the current leader by at least your outbid step.",
      "Bidding runs for your window. When it closes, the richest accepted lot wins and every other lot is refunded on the spot.",
      "Deliver the winning condition within your delivery window, and your reputation holders confirm it.",
      "Confirmed: the money is yours and every backer of the lot earns reputation for their share. Missed: everyone is refunded.",
    ],
  },
];

// Accepts a plain string so route params (always string) can be looked up directly,
// without callers needing to prove the id is a valid GameId before asking.
export function getGame(id: string): GameModule | undefined {
  return GAMES.find((g) => g.id === id);
}
