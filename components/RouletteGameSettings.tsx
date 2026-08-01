"use client";

import { useState } from "react";
import type { Profile, RouletteConfig } from "@/lib/data/types";
import { NumberInput } from "@/components/NumberInput";
import { HelpTip } from "@/components/HelpTip";
import { RulesSummary, minutesText } from "@/components/RulesSummary";
import { usd } from "@/lib/money";
import { ROULETTE_TOPICS, DEFAULT_TOPIC_ID, topicById, categoriesFor } from "@/lib/data/roulette-topics";

export const DEFAULT_ROULETTE_CONFIG: RouletteConfig = {
  minTier: "",
  excludeTopTier: false,
  genres: [],
  minDonation: 5,
  roundMinutes: 30,
  playMinutes: 60,
};

// Time is picked from sane presets (dropdowns), the same pattern as the other games — no raw number
// field where a typo becomes "1000 min". Values are stored in MINUTES, matching the config.
export const ROUND_OPTIONS = [
  { minutes: 5, label: "5 minutes" },
  { minutes: 10, label: "10 minutes" },
  { minutes: 15, label: "15 minutes" },
  { minutes: 30, label: "30 minutes" },
  { minutes: 60, label: "1 hour" },
  { minutes: 120, label: "2 hours" },
];
export const PLAY_OPTIONS = [
  { minutes: 30, label: "30 minutes" },
  { minutes: 60, label: "1 hour" },
  { minutes: 120, label: "2 hours" },
  { minutes: 180, label: "3 hours" },
  { minutes: 300, label: "5 hours" },
];

// Rules the streamer sets for the Roulette game — who's allowed to suggest a game, which
// genres count, and how long a round runs. Same live-save pattern as TaskGameSettings/
// SettingsPanel: no separate "Save" step.
export function RouletteGameSettings({ profile, onSave }: { profile: Profile; onSave: (p: Profile) => void }) {
  const cfg = profile.rouletteConfig ?? DEFAULT_ROULETTE_CONFIG;
  const [newCat, setNewCat] = useState("");

  function patch(next: Partial<RouletteConfig>) {
    onSave({ ...profile, rouletteConfig: { ...cfg, ...next } });
  }

  const topic = topicById(cfg.topic ?? DEFAULT_TOPIC_ID);
  const categories = categoriesFor(cfg.topic ?? DEFAULT_TOPIC_ID, cfg.customCategories);

  function toggleGenre(g: string) {
    const has = cfg.genres.includes(g);
    patch({ genres: has ? cfg.genres.filter((x) => x !== g) : [...cfg.genres, g] });
  }

  // Switching topic drops the old picks: "Shooter" means nothing once the wheel is about food.
  function pickTopic(id: string) {
    patch({ topic: id, genres: [] });
  }

  // Custom categories are a proper tag editor: type a category, press Enter (or comma) to add it as a
  // removable chip immediately. Dedupe is case-insensitive, so "Retro" and "retro" don't both land;
  // the input clears on add so you can keep going. Removing a chip also drops it from the allowed set
  // if it was selected. This replaces the old comma-line-on-blur, which committed invisibly and lost
  // dupes/case silently.
  const custom = cfg.customCategories ?? [];

  function addCategory(raw: string) {
    const name = raw.trim();
    if (!name) return;
    // case-insensitive dedupe against BOTH the maker's own tags and the topic's built-ins
    const existing = categoriesFor(cfg.topic, custom).map((c) => c.toLowerCase());
    if (existing.includes(name.toLowerCase())) return;
    patch({ customCategories: [...custom, name] });
  }

  function removeCategory(name: string) {
    const next = custom.filter((c) => c !== name);
    patch({ customCategories: next, genres: cfg.genres.filter((g) => categoriesFor(cfg.topic, next).includes(g)) });
  }

  return (
    <div className="game-settings">
      <section className="card" aria-labelledby="roul-money-h">
        <h2 id="roul-money-h">Money</h2>

        <div className="field">
          <label htmlFor="roul-min">
            Minimum donation to suggest
            <HelpTip text="A suggestion under this amount doesn't register. Losing suggestions stay donated — they aren't refunded." />
          </label>
          <div className="affix has-pre">
            <span className="affix-pre">$</span>
            <NumberInput id="roul-min" min={1} value={cfg.minDonation} onCommit={(n) => patch({ minDonation: n })} />
          </div>
        </div>
      </section>

      <section className="card" aria-labelledby="roul-access-h">
        <h2 id="roul-access-h">Access</h2>

        <div className="field">
          <label htmlFor="roul-tier">
            Minimum tier
            <HelpTip text="Viewers below this tier can't suggest a game." />
          </label>
          <select id="roul-tier" value={cfg.minTier} onChange={(e) => patch({ minTier: e.target.value })}>
            <option value="">Everyone</option>
            {profile.tiers.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}+
              </option>
            ))}
          </select>
        </div>

        <div className="toggle-row">
          <label className={`toggle${cfg.excludeTopTier ? " on" : ""}`}>
            <span className="track">
              <span className="knob" />
            </span>
            <input type="checkbox" hidden checked={cfg.excludeTopTier} onChange={(e) => patch({ excludeTopTier: e.target.checked })} />
            Exclude my top tier
          </label>
          <HelpTip text="For content makers whose biggest supporters already get asked directly — keeps the wheel for everyone else." />
        </div>
      </section>

      <section className="card" aria-labelledby="roul-what-h">
        <h2 id="roul-what-h">What can be suggested</h2>

        <div className="field">
          <label htmlFor="roul-topic">
            Topic
            <HelpTip text="What your wheel is about. Viewers suggest whatever fits it — not just games." />
          </label>
          <select id="roul-topic" value={cfg.topic ?? DEFAULT_TOPIC_ID} onChange={(e) => pickTopic(e.target.value)}>
            {ROULETTE_TOPICS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <p className="hint">Viewers will be asked to suggest a {topic.noun}.</p>
        </div>

        <div className="field">
          <label htmlFor="roul-custom">
            Your own categories
            <HelpTip text="Type one and press Enter to add it. Added on top of the topic's — or used alone if you picked Custom." />
          </label>
          <input
            id="roul-custom"
            type="text"
            placeholder="Type a category, press Enter"
            value={newCat}
            onChange={(e) => setNewCat(e.target.value)}
            onKeyDown={(e) => {
              // Enter or comma commits the tag immediately (visible feedback as a chip below).
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                addCategory(newCat);
                setNewCat("");
              }
            }}
            onBlur={() => {
              if (newCat.trim()) {
                addCategory(newCat);
                setNewCat("");
              }
            }}
          />
          {custom.length > 0 && (
            <div className="chips" style={{ marginTop: 4 }}>
              {custom.map((c) => (
                <span key={c} className="tag">
                  {c}
                  <button type="button" className="tag-x" aria-label={`Remove ${c}`} onClick={() => removeCategory(c)}>
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {categories.length > 0 ? (
          <div>
            <label className="block-label">
              Allowed categories
              <HelpTip text="None selected = every category is allowed." />
            </label>
            <div className="chips">
              {categories.map((g) => (
                <button key={g} type="button" className={`chip${cfg.genres.includes(g) ? " active" : ""}`} onClick={() => toggleGenre(g)}>
                  {g}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <p className="hint">No categories yet — add your own above, or pick a topic that brings its own.</p>
        )}
      </section>

      <section className="card" aria-labelledby="roul-timing-h">
        <h2 id="roul-timing-h">Timing</h2>
        <div className="field">
          <label htmlFor="roul-round">
            Round length
            <HelpTip text="How long suggestions stay open before the wheel spins." />
          </label>
          <select id="roul-round" value={cfg.roundMinutes} onChange={(e) => patch({ roundMinutes: +e.target.value })}>
            {ROUND_OPTIONS.map((o) => (
              <option key={o.minutes} value={o.minutes}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="roul-play">
            Play time for the winner
            <HelpTip text="How long you commit to playing whatever wins." />
          </label>
          <select id="roul-play" value={cfg.playMinutes} onChange={(e) => patch({ playMinutes: +e.target.value })}>
            {PLAY_OPTIONS.map((o) => (
              <option key={o.minutes} value={o.minutes}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </section>

      <RulesSummary>
        {cfg.minTier ? `${cfg.minTier}+ viewers` : "Anyone"}
        {cfg.excludeTopTier ? " (except your top tier)" : ""} can back a {topic.noun} from {usd(cfg.minDonation)}. Suggestions stay
        open {minutesText(cfg.roundMinutes)}, then {cfg.format === "elimination" ? "the wheel spins until one is left" : "one spin picks the winner"} —
        the more money behind a {topic.noun}, the better its odds. You play it for {minutesText(cfg.playMinutes)}. Money on the
        {" "}{topic.noun}s that don&apos;t win stays donated.
      </RulesSummary>
    </div>
  );
}
