// One wording for every "are you sure?" in the app.
//
// The rule: the title is ALWAYS the same word, so the dialog is recognised before it is read —
// people learn the shape once and know a real decision is in front of them. Only the sentence
// underneath changes, and it says the two things a person actually needs: what happens, and to how
// much money. A dialog that says "Are you sure?" and nothing else trains people to click through it.
//
// Everything here is a plain string builder — no React, no state — so the copy can't drift between
// the viewer's pages and the cabinet.

/** The single title shown by every confirmation in the product. */
export const CONFIRM_TITLE = "Sure?";

/** The safe way out, worded the same everywhere. */
export const CONFIRM_CANCEL = "Cancel";

function money(dollars: number): string {
  // Whole dollars everywhere else in the product, so no cents here either.
  return `$${Math.max(0, Math.round(dollars))}`;
}

// ── The viewer's money ───────────────────────────────────────────────────────────────────────────
// These all end up in escrow on-chain. "Refunded if it isn't delivered" is the honest promise: the
// money is not gone, but it is no longer in their wallet and they can't pull it back on a whim.

export const dangerCopy = {
  /** A plain donation — the one case where money moves straight to the maker, with no escrow. */
  donate: (dollars: number) => ({
    body: `Send ${money(dollars)}. It goes straight to the content maker — getting it back is up to them.`,
    confirmLabel: `Send ${money(dollars)}`,
    busyLabel: "Sending…",
  }),

  /** Paying for a task: escrow until the maker delivers or the deadline passes. */
  task: (dollars: number) => ({
    body: `Pay ${money(dollars)} for this task. It sits in escrow and comes back automatically if the task isn't done.`,
    confirmLabel: `Pay ${money(dollars)}`,
    busyLabel: "Sending…",
  }),

  /** Chipping into a fundraiser. */
  fundraiser: (dollars: number) => ({
    body: `Chip in ${money(dollars)}. It sits in escrow and comes back automatically if the goal isn't delivered.`,
    confirmLabel: `Chip in ${money(dollars)}`,
    busyLabel: "Sending…",
  }),

  bid: (dollars: number) => ({
    body: `Bid ${money(dollars)}. It sits in escrow and comes back automatically if your lot doesn't win.`,
    confirmLabel: `Bid ${money(dollars)}`,
    busyLabel: "Placing…",
  }),

  /**
   * Preview mode: the game's on-chain escrow isn't live (the ICP canister has no principal set), so
   * NOTHING here moves money. The confirm dialog must say exactly that instead of the real-escrow copy
   * above — otherwise a viewer is told their money is "in escrow, refunded if…" when no escrow, and no
   * payment, exists at all. Used by every game's public page while chain.live is false.
   */
  demoGame: (dollars: number) => ({
    body: `This is a preview — the on-chain escrow isn't live here yet, so no ${money(dollars)} moves and nothing is held. It just shows how the flow looks.`,
    confirmLabel: "Try the preview",
    busyLabel: "One sec…",
  }),

  /** Backing someone else's lot — the money joins THEIR lot, not yours. */
  backLot: (dollars: number) => ({
    body: `Add ${money(dollars)} to someone else's lot. It sits in escrow and comes back automatically if that lot doesn't win.`,
    confirmLabel: `Add ${money(dollars)}`,
    busyLabel: "Sending…",
  }),

  /** Backing a roulette suggestion. */
  roulette: (dollars: number) => ({
    body: `Put ${money(dollars)} behind this pick. It sits in escrow and comes back automatically if it doesn't win.`,
    confirmLabel: `Back it · ${money(dollars)}`,
    busyLabel: "Sending…",
  }),

  // ── The maker's decisions about OTHER people's money ───────────────────────────────────────────
  // Not reversible, and not their own money — the two things that make a decision worth stopping for.

  /** Accepting a lot: its condition goes public and the money is committed to the board. */
  acceptLot: (dollars: number) => ({
    body: `Accept this ${money(dollars)} lot. Its condition becomes public and the lot joins the board — this can't be undone.`,
    confirmLabel: "Accept lot",
    busyLabel: "Accepting…",
  }),

  /** Returning a lot: the backer's money goes back. */
  returnLot: (dollars: number) => ({
    body: `Turn down this ${money(dollars)} lot. The money goes back to whoever placed it — this can't be undone.`,
    confirmLabel: "Turn down",
    busyLabel: "Returning…",
  }),

  /** Ringing the bell: bidding stops for everyone, the top lot wins. */
  closeBidding: (dollars: number) => ({
    body: `Close the bidding. The top lot at ${money(dollars)} wins, everyone else is refunded — bidding can't be reopened.`,
    confirmLabel: "Close bidding",
    busyLabel: "Closing…",
  }),

  /** Accepting a collection below (or at) the goal: it moves to delivering and stops taking money. */
  acceptRaise: (dollars: number) => ({
    body: `Accept ${money(dollars)}. The collection closes and stops taking money, and you're on the hook to deliver.`,
    confirmLabel: `Accept ${money(dollars)}`,
    busyLabel: "Accepting…",
  }),

  /** Declaring a collection delivered — this is what opens the payout to the maker. */
  markDelivered: (dollars: number) => ({
    body: `Mark this delivered. ${money(dollars)} comes to you once backers confirm — saying so without delivering is a lie to them.`,
    confirmLabel: "Mark delivered",
    busyLabel: "Marking…",
  }),

  /** Refunding a collection: everyone gets their money back, the run is over. */
  refundRaise: (dollars: number) => ({
    body: `Refund ${money(dollars)} to everyone who backed this. The collection closes and the money goes back — this can't be undone.`,
    confirmLabel: "Refund everyone",
    busyLabel: "Refunding…",
  }),

  /** Ending a session — the public page for it stops working. */
  endSession: (name: string) => ({
    body: `End the session “${name}”. Its public page stops working and the session can't be brought back.`,
    confirmLabel: "End session",
    busyLabel: "Ending…",
  }),

  // ── The account ───────────────────────────────────────────────────────────────────────────────

  logout: () => ({
    body: "Log out on this device. Your page and everything on it stays — signing back in needs your wallet to sign again.",
    confirmLabel: "Log out",
    busyLabel: "Logging out…",
  }),

  deletePage: (handle: string) => ({
    body: `Delete @${handle} for good. The link stops working and its donations and reputation are lost — this can't be undone.`,
    confirmLabel: "Delete for good",
    busyLabel: "Deleting…",
  }),

  // ── Admin ─────────────────────────────────────────────────────────────────────────────────────

  seedData: () => ({
    body: "Add test data to the database. Made-up pages and donations appear, and clearing them out is a manual job.",
    confirmLabel: "Add it",
    busyLabel: "Adding…",
  }),

  wipeData: (pages: number) => ({
    body: `Delete ${pages} test page${pages === 1 ? "" : "s"} and everything on them. This can't be undone.`,
    confirmLabel: "Delete",
    busyLabel: "Deleting…",
  }),
} as const;
