"use client";

import { GamePageEditor, type GameEditorConfig } from "@/components/GamePageEditor";
import { AuctionGameSettings, DEFAULT_AUCTION_CONFIG } from "@/components/AuctionGameSettings";
import { AU_HEADLINE_MAX, AU_DESCRIPTION_MAX, MAX_AU_PRESETS, withAuctionDefaults } from "@/lib/data/auction";
import type { AuctionDraft, Profile } from "@/lib/data/types";

const CONFIG: GameEditorConfig = {
  slug: "auction",
  title: "Auction",
  linkLabel: "Auction link",
  qrFileName: "crown-auction-qr.png",
  headlineLabel: "Your pitch",
  headlinePlaceholder: "e.g. Highest bid picks what I do on Friday's stream",
  headlineMax: AU_HEADLINE_MAX,
  descriptionPlaceholder: "What you will and won't do — the limits, so nobody wastes a bid",
  descriptionMax: AU_DESCRIPTION_MAX,
  amountsTitle: "Bid amounts",
  maxPresets: MAX_AU_PRESETS,
  formLabel: "Bid form",
};

// The Auction page builder — the shared game editor with Auction's own words and rules panel.
export function AuctionPanel({ profile, onSave }: { profile: Profile; onSave: (p: Profile) => void }) {
  const au = withAuctionDefaults(profile);
  return (
    <GamePageEditor
      profile={profile}
      onSave={onSave}
      config={CONFIG}
      draft={au}
      patchDraft={(next, onto) => onSave({ ...(onto ?? profile), auction: { ...au, ...next } as AuctionDraft })}
      rules={<AuctionGameSettings profile={profile} onSave={onSave} />}
      minAmount={profile.auctionConfig?.minBid ?? DEFAULT_AUCTION_CONFIG.minBid}
    />
  );
}
