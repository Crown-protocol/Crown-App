"use client";

import type { Profile, TaskGameConfig } from "@/lib/data/types";
import { NumberInput } from "@/components/NumberInput";
import { HelpTip } from "@/components/HelpTip";
import { RulesSummary, hoursText } from "@/components/RulesSummary";
import { usd } from "@/lib/money";
import { PLATFORM_FLOOR, knobFloorNote } from "@/lib/data/floors";
import { FloorBump, useFloorClamp } from "@/components/games/MinNote";
import { RulesScopeNote } from "@/components/games/RulesScopeNote";

export const DEFAULT_TASK_CONFIG: TaskGameConfig = {
  minAmount: 10,
  deadlineHours: 24,
  requireApproval: true,
  maxActiveTasks: 5,
};

// Exported so the session starter (GameSessions) offers exactly the same picks — one list, so the
// standing rules and a single run's rules can never drift into different vocabularies.
export const DEADLINE_OPTIONS = [
  { hours: 6, label: "6 hours" },
  { hours: 12, label: "12 hours" },
  { hours: 24, label: "24 hours" },
  { hours: 48, label: "48 hours" },
  { hours: 72, label: "3 days" },
  { hours: 168, label: "1 week" },
];

// Rules the streamer sets for the Task game — how much a task costs at minimum, how long
// they have to complete one, whether they get to accept it first, and how many can queue up
// at once. Same live-save pattern as SettingsPanel/PageBuilder: no separate "Save" step.
export function TaskGameSettings({ profile, onSave }: { profile: Profile; onSave: (p: Profile) => void }) {
  const cfg = profile.taskConfig ?? DEFAULT_TASK_CONFIG;
  // The knob clamps to the network's floor; the explanation appears only if that
  // clamp actually did something.
  const { clamp: clampMin, bumpNote: minBump } = useFloorClamp(PLATFORM_FLOOR.task, knobFloorNote(PLATFORM_FLOOR.task, "task"));

  function patch(next: Partial<TaskGameConfig>) {
    onSave({ ...profile, taskConfig: { ...cfg, ...next } });
  }

  return (
    <div className="game-settings">
      <RulesScopeNote />
      <section className="card" aria-labelledby="task-money-h">
        <h2 id="task-money-h">Money</h2>

        <div className="field">
          <label htmlFor="task-min">
            Minimum task amount
            <HelpTip text="Viewers can't submit a task for less than this." />
          </label>
          <div className="affix has-pre">
            <span className="affix-pre">$</span>
            <NumberInput
              id="task-min"
              min={PLATFORM_FLOOR.task}
              value={cfg.minAmount}
              onCommit={(n, typed) => patch({ minAmount: clampMin(n, typed) })}
            />
          </div>
          {/* The network refuses anything below this, and it refuses it AFTER the
              money has moved — so the knob stops here rather than letting a page
              advertise a minimum that cannot be honoured. Under the field, not
              inside it: `.affix` is a flex row, and a notice in there squeezes
              the input the moment it appears. */}
          <FloorBump note={minBump} />
        </div>

        <div className="field">
          <label htmlFor="task-max">
            Max active tasks
            <HelpTip text="New tasks pause once this many are in progress, so the queue stays doable." />
          </label>
          <NumberInput id="task-max" min={1} max={50} value={cfg.maxActiveTasks} onCommit={(n) => patch({ maxActiveTasks: n })} />
        </div>
      </section>

      <section className="card" aria-labelledby="task-timing-h">
        <h2 id="task-timing-h">Timing</h2>

        <div className="field">
          <label htmlFor="task-deadline">
            Longest deadline a viewer may pick
            <HelpTip text="Miss the deadline and the viewer is refunded automatically." />
          </label>
          <select id="task-deadline" value={cfg.deadlineHours} onChange={(e) => patch({ deadlineHours: +e.target.value })}>
            {DEADLINE_OPTIONS.map((o) => (
              <option key={o.hours} value={o.hours}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="toggle-row">
          <label className={`toggle${cfg.requireApproval ? " on" : ""}`}>
            <span className="track">
              <span className="knob" />
            </span>
            <input type="checkbox" hidden checked={cfg.requireApproval} onChange={(e) => patch({ requireApproval: e.target.checked })} />
            Require your approval before the clock starts
          </label>
          <HelpTip text="Off: paying starts the timer right away. On: you confirm the task first, then it starts." />
        </div>
      </section>

      <RulesSummary>
        A viewer pays from {usd(cfg.minAmount)} and picks a deadline of up to {hoursText(cfg.deadlineHours)}.{" "}
        {cfg.requireApproval ? "You accept the task first, then the clock starts." : "The clock starts the moment they pay."}{" "}
        Up to {cfg.maxActiveTasks} {cfg.maxActiveTasks === 1 ? "task runs" : "tasks run"} at once. Miss the deadline and they get their money back.
      </RulesSummary>
    </div>
  );
}
