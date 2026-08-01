"use client";

import { GamePageEditor, type GameEditorConfig } from "@/components/GamePageEditor";
import { TaskGameSettings, DEFAULT_TASK_CONFIG } from "@/components/TaskGameSettings";
import { TASK_HEADLINE_MAX, TASK_DESCRIPTION_MAX, MAX_TASK_PRESETS, withTaskPageDefaults } from "@/lib/data/tasks";
import type { Profile, TaskDraft } from "@/lib/data/types";

const CONFIG: GameEditorConfig = {
  slug: "task",
  title: "Task",
  linkLabel: "Task link",
  qrFileName: "crown-task-qr.png",
  headlineLabel: "Your pitch",
  headlinePlaceholder: "e.g. Set me a dare — money back if I chicken out",
  headlineMax: TASK_HEADLINE_MAX,
  descriptionPlaceholder: "What you will and won't do — the limits, so nobody wastes money",
  descriptionMax: TASK_DESCRIPTION_MAX,
  amountsTitle: "Task amounts",
  maxPresets: MAX_TASK_PRESETS,
  formLabel: "Task form",
};

// The Task page builder — the shared game editor with Task's own words and its rules panel.
export function TaskPanel({ profile, onSave }: { profile: Profile; onSave: (p: Profile) => void }) {
  const tp = withTaskPageDefaults(profile);
  return (
    <GamePageEditor
      profile={profile}
      onSave={onSave}
      config={CONFIG}
      draft={tp}
      patchDraft={(next, onto) => onSave({ ...(onto ?? profile), taskPage: { ...tp, ...next } as TaskDraft })}
      rules={<TaskGameSettings profile={profile} onSave={onSave} />}
      minAmount={profile.taskConfig?.minAmount ?? DEFAULT_TASK_CONFIG.minAmount}
    />
  );
}
