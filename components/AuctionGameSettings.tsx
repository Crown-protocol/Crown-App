"use client";

import type { AuctionConfig, Profile } from "@/lib/data/types";
import { NumberInput } from "@/components/NumberInput";
import { HelpTip } from "@/components/HelpTip";
import { RulesSummary, hoursText } from "@/components/RulesSummary";
import { usd } from "@/lib/money";
import { RulesScopeNote } from "@/components/games/RulesScopeNote";

export const DEFAULT_AUCTION_CONFIG: AuctionConfig = {
  minBid: 5,
  minIncrement: 1,
  biddingHours: 24,
  performHours: 48,
};

// Time is picked from sane presets (dropdowns), matching the other games — no raw hours field where a
// typo becomes "1000h". Values are stored in HOURS.
export const BIDDING_OPTIONS = [
  { hours: 6, label: "6 hours" },
  { hours: 12, label: "12 hours" },
  { hours: 24, label: "24 hours" },
  { hours: 48, label: "48 hours" },
  { hours: 72, label: "3 days" },
  { hours: 168, label: "1 week" },
];
export const PERFORM_OPTIONS = [
  { hours: 24, label: "24 hours" },
  { hours: 48, label: "48 hours" },
  { hours: 72, label: "3 days" },
  { hours: 168, label: "1 week" },
  { hours: 336, label: "2 weeks" },
];

// Rules the streamer sets for the Auction game — the three knobs the spec gives the content
// maker (min_bid, duration, perform_window). Same live-save pattern as the sibling games:
// no separate "Save" step.
export function AuctionGameSettings({ profile, onSave }: { profile: Profile; onSave: (p: Profile) => void }) {
  const cfg = profile.auctionConfig ?? DEFAULT_AUCTION_CONFIG;

  function patch(next: Partial<AuctionConfig>) {
    onSave({ ...profile, auctionConfig: { ...cfg, ...next } });
  }

  const increment = cfg.minIncrement ?? 1;

  return (
    <div className="game-settings">
      <RulesScopeNote />
      <section className="card" aria-labelledby="au-money-h">
        <h2 id="au-money-h">Money</h2>
        <div className="field">
          <label htmlFor="au-min">
            Minimum bid
            <HelpTip text="A single bid under this amount doesn't register — keeps the board clean." />
          </label>
          <div className="affix has-pre">
            <span className="affix-pre">$</span>
            <NumberInput id="au-min" min={1} value={cfg.minBid} onCommit={(n) => patch({ minBid: n })} />
          </div>
        </div>

        <div className="field">
          <label htmlFor="au-inc">
            Minimum outbid step
            <HelpTip text="The least a viewer must beat the current leader by. A bigger step slows a bidding war; $1 keeps it lively." />
          </label>
          <div className="affix has-pre">
            <span className="affix-pre">$</span>
            <NumberInput id="au-inc" min={1} value={increment} onCommit={(n) => patch({ minIncrement: n })} />
          </div>
        </div>
      </section>

      <section className="card" aria-labelledby="au-timing-h">
        <h2 id="au-timing-h">Timing</h2>
        <div className="field">
          <label htmlFor="au-dur">
            Bidding window
            <HelpTip text="How long viewers can place and top up lots before the bell. Losing bids are refunded automatically." />
          </label>
          <select id="au-dur" value={cfg.biddingHours} onChange={(e) => patch({ biddingHours: +e.target.value })}>
            {BIDDING_OPTIONS.map((o) => (
              <option key={o.hours} value={o.hours}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="au-perf">
            Time to deliver
            <HelpTip text="Your window to do the winning condition after the final. The winner pays out only once delivery is confirmed." />
          </label>
          <select id="au-perf" value={cfg.performHours} onChange={(e) => patch({ performHours: +e.target.value })}>
            {PERFORM_OPTIONS.map((o) => (
              <option key={o.hours} value={o.hours}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </section>

      <RulesSummary>
        Bids open at {usd(cfg.minBid)} and each outbid must beat the leader by at least {usd(increment)}, running for{" "}
        {hoursText(cfg.biddingHours)}. When it closes, everyone who didn&apos;t win is refunded, and you have{" "}
        {hoursText(cfg.performHours)} to deliver — the winner&apos;s money reaches you only after that&apos;s confirmed.
      </RulesSummary>
    </div>
  );
}
