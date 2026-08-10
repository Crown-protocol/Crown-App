"use client";

import { useEffect, useState } from "react";
import { Mono } from "@/components/Mono";
import { StatTile } from "@/components/ops";
import { taskRules } from "@/lib/data/gameConfig";
import { readTasks, setTaskState, removeTask, taskTotals, type GameTask, type TaskState } from "@/lib/data/tasks";
import { useGameSync } from "@/lib/data/gameSync";
import { useGameChain } from "@/lib/chain/useGameChain";
import { taskAction, settleScope } from "@/lib/chain/gameFlows";
import { useTaskState } from "@/lib/chain/useScopeState";
import { RefundButton } from "@/components/games/RefundButton";
import { useCheer } from "@/lib/data/DataProvider";
import type { Profile } from "@/lib/data/types";
import { usd } from "@/lib/money";
import styles from "./GameOverview.module.css";

// Pill tone + label per state: purple (attn) = needs your decision, white (ok) = live/kept,
// grey (wait) = refunded. Resolved rows also dim, so the eye lands on what's still open.
const STATE_PILL: Record<TaskState, { tone: string; label: string }> = {
  pending: { tone: "attn", label: "Awaiting you" },
  active: { tone: "ok", label: "Running" },
  done: { tone: "ok", label: "Done" },
  refunded: { tone: "wait", label: "Refunded" },
};

// The streamer's live queue of paid tasks — the moment of the game the settings only describe.
// Approve to start the clock, complete to keep the money, or refund it to the viewer.
// A COMPLETED task leaves this queue for good: its money becomes a donation in the feed
// (source: "task"), so afterwards it lives where money lives — the Donations tab.
export function TaskOverview({ profile, scope }: { profile: Profile; scope?: string }) {
  const handle = scope ?? profile.handle;
  // This run's rules — the ones the session was opened with, not whatever the profile says today.
  const cfg = taskRules(profile, handle);
  const { feed } = useCheer();
  const [tasks, setTasks] = useState<GameTask[]>([]);

  // Shared game state: viewers' tasks from other browsers land via the nonce dep.
  const syncNonce = useGameSync(handle);
  useEffect(() => setTasks(readTasks(handle)), [handle, syncNonce]);

  const chain = useGameChain("task");

  // On-chain twin of a queue action: chain-born tasks (t.task set) get the canister call too —
  // pending→active = accept, pending→refunded = decline. Mock rows just move in the queue.
  // The canister is addressed by the SCOPE id, never by the escrow address.
  function chainTwin(t: GameTask | undefined, state: TaskState) {
    if (!t?.task || !chain.live || !chain.wallet) return;
    const action = state === "active" ? "accept" : t.state === "pending" && state === "refunded" ? "decline" : null;
    if (action) void taskAction(chain.wallet, t.task, action);
  }

  function act(id: string, state: TaskState) {
    chainTwin(tasks.find((x) => x.id === id), state);
    setTasks(setTaskState(handle, id, state));
  }

  // Complete: the escrow settles — money to the streamer, reputation to the viewer, a feed
  // entry with source "task" — and the row disappears from this queue.
  function complete(t: GameTask) {
    // "Done" on a chain-born task = ready: the streamer claims delivery, the vote decides.
    if (t.task && chain.live && chain.wallet) void taskAction(chain.wallet, t.task, "ready");
    // Nothing is written to the feed here. A task's money reaches the creator
    // through the escrow's own settlement, and the feed mirrors that settlement
    // when it lands — inventing a row now would show money that has not moved.
    setTasks(removeTask(handle, t.id));
  }

  const totals = taskTotals(tasks);
  // Earned = every task that ever settled into the feed, not just this queue's leftovers.
  const earned = feed.filter((d) => d.source === "task").reduce((sum, d) => sum + d.amount, 0);
  // Completed tasks are gone (they're in Donations); seeded "done" rows hide by the same rule.
  const shown = tasks.filter((t) => t.state !== "done");

  return (
    <div className={styles.col}>
      <div className="footnote">
        Approve a task to start its clock, complete it to keep the money, or refund it to the viewer. Completed
        tasks move to Donations.
      </div>

      <div className="stat-grid">
        <StatTile k="Awaiting you" v={String(totals.pending)} />
        <StatTile k="Active" v={`${totals.active} / ${cfg.maxActiveTasks}`} />
        <StatTile k="Earned" v={usd(earned)} />
      </div>

      {shown.length === 0 ? (
        <div className="empty-log">No tasks yet — share your task page so viewers can set you one.</div>
      ) : (
        <div className={styles.list}>
          {shown.map((t) => {
            const pill = STATE_PILL[t.state];
            // `done` rows are filtered out of `shown` above, so a resolved (dimmed) row here is a refund.
            const resolved = t.state === "refunded";
            return (
              <div key={t.id} className={`${styles.row}${resolved ? ` ${styles.rowDone}` : ""}`}>
                <Mono name={t.from} size={40} />
                <div className={styles.rowMain}>
                  <div className={styles.rowTop}>
                    <span className={styles.who}>{t.from}</span>
                    <span className={styles.when}>
                      {t.when}
                      {t.durationHours ? ` · ${t.durationHours}h window` : ""}
                    </span>
                  </div>
                  <div className={styles.text}>{t.text}</div>
                  {t.state === "pending" && (
                    <div className={styles.actions}>
                      <button type="button" className="btn" onClick={() => act(t.id, "active")}>
                        Approve
                      </button>
                      <button type="button" className="btn-outline" onClick={() => act(t.id, "refunded")}>
                        Decline
                      </button>
                    </div>
                  )}
                  {t.state === "active" && (
                    <div className={styles.actions}>
                      <button type="button" className="btn" onClick={() => complete(t)}>
                        Mark done
                      </button>
                      <button type="button" className="btn-outline" onClick={() => act(t.id, "refunded")}>
                        Refund
                      </button>
                    </div>
                  )}
                </div>
                <div className={styles.side}>
                  <span className={styles.amount}>
                    {usd(t.amount)}
                  </span>
                  <ChainState task={t} recipient={profile.address} wallet={chain.wallet} fallback={pill} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// What the CANISTER says about a task, next to what the queue says. They can
// disagree — a viewer's vote closing the window, an accept made in another
// browser — and when they do the canister is right.
//
// A decided scope is also the moment money can move: the verdict signature is
// public, and `claim` is permissionless, so the button below is offered to
// whoever has this screen open rather than reserved for the creator.
function ChainState({
  task,
  recipient,
  wallet,
  fallback,
}: {
  task: GameTask;
  recipient: string;
  wallet: ReturnType<typeof useGameChain>["wallet"];
  fallback: { tone: string; label: string };
}) {
  const { state, live } = useTaskState(task.task);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  if (!live || !task.task) {
    return (
      <span className={`pill ${fallback.tone}`}>
        <span className="dot" />
        {fallback.label}
      </span>
    );
  }

  const decided = state === "DecidedSettle" || state === "DecidedCancel";
  const label =
    state === null
      ? "Not registered"
      : state === "Created"
        ? "Awaiting you"
        : state === "Accepted"
          ? "Running"
          : state === "Voting"
            ? "Being judged"
            : state === "DecidedSettle"
              ? "Yours to claim"
              : "Refunding";
  const tone = state === "DecidedSettle" ? "ok" : state === "DecidedCancel" ? "wait" : state === "Created" ? "attn" : "ok";

  async function settle() {
    if (!wallet || !task.escrow || !task.donor || !task.task) return;
    setBusy(true);
    setNote("");
    const res = await settleScope(wallet, {
      game: "task",
      scope: task.task,
      escrow: task.escrow,
      donor: task.donor,
      recipient,
    });
    setBusy(false);
    setNote(res.ok ? "Sent." : res.error);
  }

  return (
    <>
      <span className={`pill ${tone}`}>
        <span className="dot" />
        {label}
      </span>
      {decided && wallet && task.escrow && task.donor && (
        <button type="button" className="btn-outline" disabled={busy} onClick={() => void settle()}>
          {busy ? "Settling…" : state === "DecidedSettle" ? "Release the money" : "Return the money"}
        </button>
      )}
      {/* The deadline's own guarantee, offered once it applies: past that moment
          anyone can hand the escrow back, no verdict and no signature needed.
          It is what a silent resolver degrades into. */}
      {!decided && task.escrow && task.donor && task.deadline && (
        <RefundButton
          wallet={wallet}
          escrow={task.escrow}
          donor={task.donor}
          deadline={task.deadline}
          label="Refund it (deadline passed)"
        />
      )}
      {note && <span className="footnote">{note}</span>}
    </>
  );
}
