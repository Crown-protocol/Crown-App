// Task game — the public task page's draft, the streamer's queue of paid tasks, and the
// localStorage mock behind both. Data + store, no React. The real queue will come from
// cheer-app/api reading the escrows; until then this seeds the cabinet's Task → Overview tab
// and lets the page and its actions actually stick.

import type { PageWidget, Profile, TaskDraft } from "./types";
import { DEFAULT_DESIGN } from "./pagebuilder";
import { sendOp } from "./gameSync";

export const TASK_HEADLINE_MAX = 140;
export const TASK_DESCRIPTION_MAX = 300;
export const MAX_TASK_PRESETS = 6;

export const DEFAULT_TASK_WIDGETS: PageWidget[] = [
  { kind: "donate", enabled: true },
  { kind: "socials", enabled: true },
];

export const DEFAULT_TASK_PRESETS: number[] = [10, 25, 50];

export const DEFAULT_TASK_PAGE: TaskDraft = {
  headline: "",
  description: "",
  descriptionEnabled: true,
  presets: DEFAULT_TASK_PRESETS,
  widgets: DEFAULT_TASK_WIDGETS,
  design: DEFAULT_DESIGN,
};

// Back-fills pages saved before the task page existed. `task` was the old author-page builder's
// one-line field — it never rendered anywhere, so it seeds the headline rather than being dropped.
export function withTaskPageDefaults(profile: Profile): TaskDraft {
  const tp = profile.taskPage;
  return {
    ...DEFAULT_TASK_PAGE,
    headline: tp?.headline ?? profile.task ?? "",
    ...(tp ?? {}),
    presets: tp?.presets?.length ? tp.presets : DEFAULT_TASK_PRESETS,
    widgets: tp?.widgets?.length ? tp.widgets : DEFAULT_TASK_WIDGETS,
    design: tp?.design ?? DEFAULT_DESIGN,
  };
}

export type TaskState = "pending" | "active" | "done" | "refunded";

export interface GameTask {
  id: string;
  from: string; // viewer name
  amount: number; // $ locked in escrow for this task
  text: string; // what the viewer is paying for
  state: TaskState;
  when: string; // human-readable "2h ago", like the donations feed
  durationHours?: number; // the DONOR's deadline pick (game-spec: duration is the donor's knob)
  // Set when the task was born on chain. The two are NOT the same string and the
  // difference matters: `task` is the canister's scope id (base58 of the
  // `task_id` hash) and is what every canister call names; `escrow` is the
  // Solana account holding the money. The scope id cannot be the address —
  // the address derives from the resolver, and the resolver from the scope id.
  task?: string;
  escrow?: string;
  // The donor's wallet. Needed to settle: `claim` hands the vault's residual and
  // the rent back to whoever funded the escrow, so the account has to be named.
  donor?: string;
  // Unix seconds. After this the escrow refunds to the donor with no signature
  // from anyone — the guarantee that a silent resolver cannot strand the money.
  deadline?: number;
}


const KEY = "cheer-tasks";

export function readTasks(handle: string): GameTask[] {
  try {
    const raw = localStorage.getItem(`${KEY}:${handle}`);
    if (raw) {
      const list = JSON.parse(raw);
      if (Array.isArray(list)) return list;
    }
  } catch {}
  // Nothing stored yet means nobody has set a task here. There is no sample queue
  // to fall back on — an invented row in a creator's cabinet is a task they would
  // go looking for.
  return [];
}

function writeTasks(handle: string, list: GameTask[]) {
  try {
    localStorage.setItem(`${KEY}:${handle}`, JSON.stringify(list));
  } catch {}
}

// A viewer sets a task from the public page. `requireApproval` decides where it lands: waiting
// for the streamer to accept, or straight into the running queue with the clock already going.
export function addTask(
  handle: string,
  input: { from: string; amount: number; text: string; requireApproval: boolean; durationHours?: number; task?: string; escrow?: string; donor?: string; deadline?: number }
): GameTask[] {
  const task: GameTask = {
    id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    from: input.from.trim() || "Anonymous",
    amount: input.amount,
    text: input.text.trim(),
    state: input.requireApproval ? "pending" : "active",
    when: "just now",
    durationHours: input.durationHours,
    ...(input.task ? { task: input.task } : {}),
    ...(input.escrow ? { escrow: input.escrow } : {}),
    ...(input.donor ? { donor: input.donor } : {}),
    ...(input.deadline ? { deadline: input.deadline } : {}),
  };
  const next = [task, ...readTasks(handle)];
  writeTasks(handle, next);
  // Share it: append commutes with other viewers' tasks; `seed` initialises the
  // server copy with the demo rows on the very first real action in a scope.
  sendOp(handle, "cheer-tasks", { type: "append", item: task as unknown as { id: string } & Record<string, unknown>, seed: next });
  return next;
}

// How many tasks are in flight — the queue cap (TaskGameConfig.maxActiveTasks) counts these.
export function activeCount(list: GameTask[]): number {
  return list.filter((t) => t.state === "pending" || t.state === "active").length;
}

// A completed task leaves the queue entirely — its money lives on as a donation in the feed
// (source: "task"), which is where the streamer finds it afterwards: the Donations tab.
export function removeTask(handle: string, id: string): GameTask[] {
  const next = readTasks(handle).filter((t) => t.id !== id);
  writeTasks(handle, next);
  // The streamer is the queue's single authority — their removals/state moves overwrite.
  sendOp(handle, "cheer-tasks", { type: "replace", value: next });
  return next;
}

// Move one task to a new state (approve/decline/complete/refund) and persist the whole queue.
export function setTaskState(handle: string, id: string, state: TaskState): GameTask[] {
  const next = readTasks(handle).map((t) => (t.id === id ? { ...t, state } : t));
  writeTasks(handle, next);
  sendOp(handle, "cheer-tasks", { type: "replace", value: next });
  return next;
}

// Counts the cabinet cares about: what's waiting, what's running, and what you've earned.
export function taskTotals(list: GameTask[]) {
  return {
    pending: list.filter((t) => t.state === "pending").length,
    active: list.filter((t) => t.state === "active").length,
    earned: list.filter((t) => t.state === "done").reduce((sum, t) => sum + t.amount, 0),
  };
}
