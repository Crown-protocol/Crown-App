import { readStore, queueNotify } from "./telegram-store";
import type { GameOp } from "./gameState";

// Turns a game state change into the Telegram notification a creator actually needs.
//
// This is the bridge that was missing: the only thing that ever reached Telegram was a donation
// from the indexer, so the whole point of connecting the bot — "don't let me miss a paid task's
// deadline" — produced exactly zero messages. Every mini-game writes through
// POST /api/gamestate, so one hook here covers all of them.
//
// Rules of the house: a notification states a fact after it happened, names the money plainly, and
// only interrupts when something needs the creator. Anything else is a nice-to-know, and the
// creator's category toggles decide whether it arrives at all (queueNotify enforces that).

// scope is "<handle>" or "<handle>:<gameId>" or "<handle>:<gameId>:<sessionId>" — the page is
// always the first segment.
function handleOf(scope: string): string {
  return (scope.split(":")[0] || "").toLowerCase();
}

const usd = (n: unknown) => `$${Math.round(Number(n) || 0).toLocaleString("en-US")}`;
const clip = (s: unknown, n = 90) => {
  const t = String(s ?? "").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

// Fire-and-forget: a notification must never break or slow the game write that triggered it.
export function notifyGameEvent(scope: string, key: string, op: GameOp): void {
  void (async () => {
    try {
      const handle = handleOf(scope);
      if (!handle) return;
      const s = await readStore();
      if (!s.links[handle]) return; // nobody to tell

      const send = (kind: Parameters<typeof queueNotify>[2], title: string, body: string) =>
        queueNotify(s, handle, kind, title, body);

      switch (key) {
        // ---- Task for donation: money is on the line, so these are the loud ones ----
        case "crown-tasks": {
          if (op.type === "append") {
            const t = op.item as { amount?: number; text?: string; from?: string };
            await send(
              "task_offered",
              `A task for ${usd(t.amount)}`,
              `${clip(t.from) || "Someone"} asked: ${clip(t.text)}. Approve it in your space to start the clock.`
            );
          } else if (op.type === "entry") {
            const e = op.entry as { state?: string; amount?: number; text?: string };
            if (e.state === "active") {
              // The clock is now running on money the creator owes work for — that's the deadline
              // notification the bot exists for.
              await send("task_deadline_soon", `Task accepted — ${usd(e.amount)}`, `The clock is running on: ${clip(e.text)}`);
            } else if (e.state === "refunded") {
              await send("task_refunded", `Task refunded — ${usd(e.amount)}`, `${clip(e.text)} went back to the viewer.`);
            }
          }
          break;
        }

        // ---- Auction: a new lot is money offered; the close is a decision point ----
        case "crown-auction-lots": {
          if (op.type === "append") {
            const l = op.item as { amount?: number; text?: string; from?: string };
            await send(
              "auction_lot_offered",
              `New lot — ${usd(l.amount)}`,
              `${clip(l.from) || "Someone"} bid on: ${clip(l.text)}`
            );
          }
          break;
        }
        case "crown-auction-meta": {
          if (op.type === "replace") {
            const m = op.value as { state?: string; winnerId?: string };
            if (m?.state === "performing") {
              await send("auction_closing", "Auction closed", "The winning lot is yours to deliver — open your space for the details.");
            } else if (m?.state === "settled") {
              await send("payout", "Auction settled", "The money is on its way to your wallet.");
            }
          }
          break;
        }

        // ---- Fundraiser: the goal and the delivery window ----
        case "crown-fundraiser-collected": {
          if (op.type === "add" && Number(op.delta) > 0) {
            await send("donation", `Someone chipped in ${usd(op.delta)}`, "Your fundraiser just moved.");
          }
          break;
        }
        case "crown-fundraiser-status": {
          if (op.type === "replace") {
            const st = op.value as { state?: string; accepted?: number };
            if (st?.state === "delivering") {
              await send(
                "fundraiser_goal_hit",
                `Fundraiser accepted — ${usd(st.accepted)}`,
                "Your delivery window has started. Deliver in time or everyone is refunded."
              );
            } else if (st?.state === "delivered") {
              await send("payout", "Fundraiser delivered", "The payout is yours.");
            } else if (st?.state === "refunded") {
              await send("fundraiser_refunded", "Fundraiser refunded", "Everyone got their money back.");
            }
          }
          break;
        }

        // ---- Roulette: a suggestion is a donation; the verdict closes the round ----
        case "crown-roulette-round": {
          if (op.type === "suggest" && Number(op.dPool) > 0) {
            await send("donation", `${usd(op.dPool)} on "${clip(op.title, 40)}"`, "A viewer backed a pick on your wheel.");
          }
          break;
        }
        case "crown-roulette-meta": {
          if (op.type === "replace") {
            const m = op.value as { winner?: { title?: string } | null };
            if (m?.winner?.title) {
              await send("roulette_settled", `The wheel picked "${clip(m.winner.title, 40)}"`, "Round closed — that's what you're on the hook for.");
            }
          }
          break;
        }
      }
    } catch {
      // A failed notification must never surface as a failed game action.
    }
  })();
}
