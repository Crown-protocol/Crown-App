"use client";

import { GamePageEditor, type GameEditorConfig } from "@/components/GamePageEditor";
import { RouletteGameSettings, DEFAULT_ROULETTE_CONFIG } from "@/components/RouletteGameSettings";
import { RL_HEADLINE_MAX, RL_DESCRIPTION_MAX, MAX_RL_PRESETS, withRouletteDefaults } from "@/lib/data/roulette";
import type { Profile, RouletteDraft } from "@/lib/data/types";

const CONFIG: GameEditorConfig = {
  slug: "roulette",
  title: "Roulette",
  linkLabel: "Roulette link",
  qrFileName: "cheer-roulette-qr.png",
  headlineLabel: "Your pitch",
  headlinePlaceholder: "e.g. You pick what I do next — suggest anything",
  headlineMax: RL_HEADLINE_MAX,
  descriptionPlaceholder: "House rules: when the wheel spins, what's off the table, how long you play",
  descriptionMax: RL_DESCRIPTION_MAX,
  amountsTitle: "Backing amounts",
  maxPresets: MAX_RL_PRESETS,
  formLabel: "Suggest form",
};

// The Roulette page builder — the shared game editor with Roulette's own words and rules panel.
export function RoulettePanel({ profile, onSave }: { profile: Profile; onSave: (p: Profile) => void }) {
  const rl = withRouletteDefaults(profile);
  return (
    <GamePageEditor
      profile={profile}
      onSave={onSave}
      config={CONFIG}
      draft={rl}
      patchDraft={(next, onto) => onSave({ ...(onto ?? profile), roulette: { ...rl, ...next } as RouletteDraft })}
      rules={<RouletteGameSettings profile={profile} onSave={onSave} />}
      minAmount={profile.rouletteConfig?.minDonation ?? DEFAULT_ROULETTE_CONFIG.minDonation}
    />
  );
}
