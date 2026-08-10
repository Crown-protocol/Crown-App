import {
  DS_MIN_GROSS,
  INDEX_MIN_GROSS,
  MIN_GROSS_FUNDING,
  MIN_GROSS_TASK,
  USDC_DECIMALS,
} from "@/lib/chain/config";
import { usdPrecise as usd } from "@/lib/money";

// ──────────────────────────────────────────────────────────────────
// Minimums, in one place, because there are two kinds and they are easy to
// confuse — including by us, until this file existed.
//
//   · the PLATFORM floor comes from the perimeter's economics: below it the
//     canister refuses a registration, or folding the donation into the book
//     costs more than the fee it earned. It is not negotiable and not ours to
//     lower per page.
//   · the CREATOR floor is a knob in the cabinet ("tasks from $5").
//
// What a viewer must be shown is neither of them on its own — it is the higher
// of the two, because that is the number their money will actually be measured
// against. Showing only the creator's meant a $1 task looked fine right up to
// the canister's refusal, which lands AFTER the escrow is funded.
//
// Every floor here is in dollars, the unit the UI speaks.
// ──────────────────────────────────────────────────────────────────

const dollars = (minor: number) => minor / 10 ** USDC_DECIMALS;

/** The platform's own floors, in dollars. */
export const PLATFORM_FLOOR = {
  /** A donation that carries a name or a message (it pays the service fee). */
  donationWithWords: dollars(DS_MIN_GROSS),
  /** What the book itself refuses as dust — applies to what actually reaches the creator. */
  bookDust: dollars(INDEX_MIN_GROSS),
  task: dollars(MIN_GROSS_TASK),
  fundraiser: dollars(MIN_GROSS_FUNDING),
} as const;

export interface Floor {
  /** The number a viewer's amount is actually measured against. */
  amount: number;
  /** Which side set it — decides whether the message explains itself. */
  source: "platform" | "creator";
  /**
   * What to say when the amount is BELOW the floor — the only moment this is
   * shown. A creator's own minimum needs no defence; the network's does, or it
   * reads as the creator being greedy.
   */
  short: string;
}

function combine(platform: number, creator: number | undefined, what: string): Floor {
  const c = typeof creator === "number" && creator > 0 ? creator : 0;
  if (c >= platform) {
    return { amount: c, source: "creator", short: `${usd(c)} minimum.` };
  }
  return {
    amount: platform,
    source: "platform",
    short: `${usd(platform)} minimum — the smallest ${what} the network will record.`,
  };
}

/** A paid task: the game's floor, or the creator's if they set a higher one. */
export const taskFloor = (creatorMin?: number): Floor => combine(PLATFORM_FLOOR.task, creatorMin, "task");

/** A chip-in toward a collection. */
export const fundraiserFloor = (creatorMin?: number): Floor =>
  combine(PLATFORM_FLOOR.fundraiser, creatorMin, "contribution");

/**
 * Backing a suggestion on the wheel. It rides the ordinary donation path and
 * always carries words (the suggestion itself), so the paid floor applies.
 */
export const rouletteFloor = (creatorMin?: number): Floor =>
  combine(PLATFORM_FLOOR.donationWithWords, creatorMin, "suggestion");

/**
 * A plain donation. The floor depends on what the donor typed, and this is the
 * one place where the difference is visible to them:
 *
 *   · with a name or a message → the paid shape, so the platform floor applies;
 *   · with neither → any amount at all. There is no fee, so there is no floor of
 *     ours to enforce; the only caveat is that a very small one earns no
 *     reputation, because the book calls it dust.
 */
export function donationFloor(withWords: boolean): Floor {
  if (withWords) {
    return {
      amount: PLATFORM_FLOOR.donationWithWords,
      source: "platform",
      // Said only when they are short, and it names the way out: the minimum is
      // the price of the words, not of donating.
      short: `${usd(PLATFORM_FLOOR.donationWithWords)} minimum with a name or a message — clear both to send any amount.`,
    };
  }
  // No fee, so no floor of ours: there is nothing this can ever be short of.
  return { amount: 0, source: "platform", short: "" };
}

/**
 * What a cabinet knob says AFTER it has clamped a too-low number — not before.
 * The creator finds out the floor exists at the one moment it affected them.
 */
export function knobFloorNote(platform: number, what: string): string {
  return `Raised to ${usd(platform)} — the smallest ${what} the network records.`;
}
