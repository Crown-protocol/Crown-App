"use client";

import type { FundraiserConfig, Profile } from "@/lib/data/types";
import { NumberInput } from "@/components/NumberInput";
import { HelpTip } from "@/components/HelpTip";
import { RulesSummary, daysText } from "@/components/RulesSummary";
import { WarnIcon } from "@/components/WarnIcon";
import { withFundraiserDefaults } from "@/lib/data/fundraiser";
import { usd } from "@/lib/money";
import { PLATFORM_FLOOR, knobFloorNote } from "@/lib/data/floors";
import { FloorBump, useFloorClamp } from "@/components/games/MinNote";
import { RulesScopeNote } from "@/components/games/RulesScopeNote";

export const DEFAULT_FUNDRAISER_CONFIG: FundraiserConfig = {
  minContribution: 1,
  fundingDays: 14,
  deliveryDays: 30,
  allowBelowGoal: true,
  minAcceptPct: 50,
};

// Spec bounds: funding 1h–30d, delivery 1h–90d — the UI offers sane day-sized picks.
export const FUNDING_OPTIONS = [
  { days: 1, label: "1 day" },
  { days: 3, label: "3 days" },
  { days: 7, label: "1 week" },
  { days: 14, label: "2 weeks" },
  { days: 30, label: "30 days" },
];
export const DELIVERY_OPTIONS = [
  { days: 7, label: "1 week" },
  { days: 14, label: "2 weeks" },
  { days: 30, label: "30 days" },
  { days: 60, label: "60 days" },
  { days: 90, label: "90 days" },
];

// Rules the streamer sets for the Fundraiser game — minimum chip-in, how long the collection
// and delivery run, and whether a partial goal can be accepted. Same live-save pattern as
// TaskGameSettings/SettingsPanel: no separate "Save" step.
export function FundraiserGameSettings({ profile, onSave }: { profile: Profile; onSave: (p: Profile) => void }) {
  const cfg = profile.fundraiserConfig ?? DEFAULT_FUNDRAISER_CONFIG;
  // The knob clamps to the network's floor; the explanation appears only if that
  // clamp actually did something.
  const { clamp: clampMin, bumpNote: minBump } = useFloorClamp(PLATFORM_FLOOR.fundraiser, knobFloorNote(PLATFORM_FLOOR.fundraiser, "contribution"));

  function patch(next: Partial<FundraiserConfig>) {
    onSave({ ...profile, fundraiserConfig: { ...cfg, ...next } });
  }

  // The accept threshold is a % of the fundraiser's goal — meaningless without the goal beside it.
  // Read the goal from the maker's fundraiser page so the % can be shown as a real dollar amount.
  const goal = withFundraiserDefaults(profile).goal;
  const acceptDollars = Math.round((goal * cfg.minAcceptPct) / 100);

  return (
    <div className="game-settings">
      <RulesScopeNote />
      <section className="card" aria-labelledby="fr-money-h">
        <h2 id="fr-money-h">Money</h2>

        <div className="field">
          <label htmlFor="fr-min">
            Minimum chip-in
            <HelpTip text="Minimum per chip-in." />
          </label>
          <div className="affix has-pre">
            <span className="affix-pre">$</span>
            <NumberInput
              id="fr-min"
              min={PLATFORM_FLOOR.fundraiser}
              value={cfg.minContribution}
              onCommit={(n, typed) => patch({ minContribution: clampMin(n, typed) })}
            />
          </div>
          {/* The network refuses anything below this, and it refuses it AFTER the
              money has moved — so the knob stops here rather than letting a page
              advertise a minimum that cannot be honoured. Under the field, not
              inside it: `.affix` is a flex row, and a notice in there squeezes
              the input the moment it appears. */}
          <FloorBump note={minBump} />
        </div>

        <div className="toggle-row">
          <label className={`toggle${cfg.allowBelowGoal ? " on" : ""}`}>
            <span className="track">
              <span className="knob" />
            </span>
            <input type="checkbox" hidden checked={cfg.allowBelowGoal} onChange={(e) => patch({ allowBelowGoal: e.target.checked })} />
            Allow closing below the goal
          </label>
          <HelpTip text="Accept a partial amount, or require the full goal." />
        </div>

        {cfg.allowBelowGoal && (
          <div className="field">
            <label htmlFor="fr-accept">
              But no less than
              <HelpTip text="% of the goal. Below this the accept button stays off." />
            </label>
            <div className="affix has-suf">
              <NumberInput id="fr-accept" min={1} max={100} value={cfg.minAcceptPct} onCommit={(n) => patch({ minAcceptPct: n })} />
              <span className="affix-suf">%</span>
            </div>
            <p className="hint">
              = <b className="num">{usd(acceptDollars)}</b> at your <span className="num">{usd(goal)}</span> goal.
            </p>
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="fr-timing-h">
        <h2 id="fr-timing-h">Timing</h2>

        <div className="field">
          <label htmlFor="fr-funding">
            Collection runs for
            <HelpTip text="If you haven't accepted the amount by then, everyone is refunded automatically." />
          </label>
          <select id="fr-funding" value={cfg.fundingDays} onChange={(e) => patch({ fundingDays: +e.target.value })}>
            {FUNDING_OPTIONS.map((o) => (
              <option key={o.days} value={o.days}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="fr-delivery">
            Time to deliver
            <HelpTip text="Counted from the moment you accept the amount. Don't deliver and every backer is refunded in full." />
          </label>
          <select id="fr-delivery" value={cfg.deliveryDays} onChange={(e) => patch({ deliveryDays: +e.target.value })}>
            {DELIVERY_OPTIONS.map((o) => (
              <option key={o.days} value={o.days}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {cfg.deliveryDays < cfg.fundingDays && (
          <div className="rules-warn" role="status">
            <WarnIcon />
            <span>
              You&apos;re giving yourself <b>{daysText(cfg.deliveryDays)}</b> to deliver but collecting for{" "}
              <b>{daysText(cfg.fundingDays)}</b> — an unusually short delivery window. Allowed, just double-check it&apos;s what you want.
            </span>
          </div>
        )}
      </section>

      <RulesSummary>
        Backers chip in from {usd(cfg.minContribution)} for {daysText(cfg.fundingDays)}.{" "}
        {cfg.allowBelowGoal
          ? `You can accept once ${cfg.minAcceptPct}% of the goal is in;`
          : "You can only accept once the full goal is in;"}{" "}
        after that you have {daysText(cfg.deliveryDays)} to deliver. Don&apos;t, and every backer is refunded in full.
      </RulesSummary>
    </div>
  );
}
