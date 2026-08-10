import type { GameId } from "./data/games";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Formats an ISO date ("2026-07-14") as a short "14 Jul". Parses by hand instead of via Date so
// it's timezone-proof and deterministic — the feed date shouldn't shift by the viewer's clock.
export function formatFeedDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS[m - 1]}`;
}

// Where a donation came from — a plain donation, or through one of the mini-games.
export const SOURCE_LABEL: Record<GameId | "direct", string> = {
  direct: "Regular donation",
  task: "Task for donation",
  roulette: "Roulette",
  fundraiser: "Fundraiser",
};
