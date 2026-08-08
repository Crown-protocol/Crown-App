// Task game — the public task page's draft, the streamer's queue of paid tasks, and the
// localStorage mock behind both. Data + store, no React. The real queue will come from
// cheer-app/api reading the escrows; until then this seeds the cabinet's Task → Overview tab
// and lets the page and its actions actually stick.

import type { PageWidget, Profile, TaskDraft } from "./types";
import { isFreshScope } from "./freshScope";
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
  escrow?: string; // base58 escrow address when the task was born on-chain (task_id ≡ escrow)
}

// Seed queue — a realistic mix so the tab shows every state: awaiting approval, running,
// and already resolved. Newest first.
export const MOCK_TASKS: GameTask[] = [
  { id: "t1", from: "Timur", amount: 50, text: "Beat the first boss with no armor on.", state: "pending", when: "8 min ago" },
  { id: "t2", from: "anna_k", amount: 25, text: "Speak only in rhymes for one full game.", state: "pending", when: "20 min ago" },
  { id: "t3", from: "Max", amount: 40, text: "Play the next round on inverted controls.", state: "active", when: "1h ago" },
  { id: "t4", from: "Dan", amount: 15, text: "Do the intro voiceover as a pirate.", state: "active", when: "2h ago" },
  { id: "t5", from: "lena", amount: 80, text: "Finish a clutch 1v3 to win the map.", state: "done", when: "Yesterday" },
  { id: "t6", from: "guest_91", amount: 10, text: "Impossible speedrun in under a minute.", state: "refunded", when: "Yesterday" },
];

const KEY = "cheer-tasks";

export function readTasks(handle: string): GameTask[] {
  try {
    const raw = localStorage.getItem(`${KEY}:${handle}`);
    if (raw) {
      const list = JSON.parse(raw);
      if (Array.isArray(list)) return list;
    }
  } catch {}
  // First visit: start from the seed — unless this scope is a fresh session, which starts empty.
  if (isFreshScope(handle)) return [];
  return MOCK_TASKS.map((t) => ({ ...t }));
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
  input: { from: string; amount: number; text: string; requireApproval: boolean; durationHours?: number; escrow?: string }
): GameTask[] {
  const task: GameTask = {
    id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    from: input.from.trim() || "Anonymous",
    amount: input.amount,
    text: input.text.trim(),
    state: input.requireApproval ? "pending" : "active",
    when: "just now",
    durationHours: input.durationHours,
    ...(input.escrow ? { escrow: input.escrow } : {}),
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
