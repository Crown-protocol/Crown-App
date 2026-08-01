"use client";

import { useRef, useState } from "react";
import { GamePageEditor, type GameEditorConfig } from "@/components/GamePageEditor";
import { FundraiserGameSettings, DEFAULT_FUNDRAISER_CONFIG } from "@/components/FundraiserGameSettings";
import { CrownBadge } from "@/components/CrownBadge";
import { CropModal } from "@/components/CropModal";
import { NumberInput } from "@/components/NumberInput";
import { UploadIcon } from "@/components/icons";
import { PLEDGE_MAX, FR_DESCRIPTION_MAX, MAX_FR_PRESETS, withFundraiserDefaults } from "@/lib/data/fundraiser";
import type { FundraiserDraft, Profile } from "@/lib/data/types";
import styles from "./PageBuilder.module.css";

const CONFIG: GameEditorConfig = {
  slug: "fundraiser",
  title: "Fundraiser",
  linkLabel: "Fundraiser link",
  qrFileName: "crown-fundraiser-qr.png",
  headlineLabel: "The promise",
  headlinePlaceholder: "e.g. I'll edit the travel video in one month instead of three",
  headlineMax: PLEDGE_MAX,
  descriptionPlaceholder: "Details: what exactly, when, and what backers get out of it",
  descriptionMax: FR_DESCRIPTION_MAX,
  amountsTitle: "Chip-in amounts",
  maxPresets: MAX_FR_PRESETS,
  formLabel: "Chip-in form",
};

// The Fundraiser page builder — the shared game editor, plus the two fields only this game has:
// the money goal and the picture that fills up as the goal is reached.
export function FundraiserPanel({ profile, onSave }: { profile: Profile; onSave: (p: Profile) => void }) {
  const fr = withFundraiserDefaults(profile);
  const fillFileRef = useRef<HTMLInputElement>(null);
  const [cropSrc, setCropSrc] = useState("");

  function patchFr(next: Partial<FundraiserDraft>) {
    onSave({ ...profile, fundraiser: { ...fr, ...next } });
  }

  // The progress picture goes through the same reframe-in-a-circle crop as the avatar.
  function openFillCrop(file: File | undefined) {
    if (!file || !file.type.startsWith("image/")) return;
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc(URL.createObjectURL(file));
  }

  function closeFillCrop() {
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc("");
  }

  return (
    <>
      <GamePageEditor
        profile={profile}
        onSave={onSave}
        config={CONFIG}
          minAmount={profile.fundraiserConfig?.minContribution ?? DEFAULT_FUNDRAISER_CONFIG.minContribution}
        // Fundraiser calls its headline "pledge" on the wire; the editor speaks `headline`.
        draft={{ ...fr, headline: fr.pledge }}
        patchDraft={({ headline, ...rest }, onto) =>
          onSave({
            ...(onto ?? profile),
            fundraiser: {
              ...fr,
              ...(rest as Partial<FundraiserDraft>),
              ...(headline !== undefined ? { pledge: headline as string } : {}),
            },
          })
        }
        rules={<FundraiserGameSettings profile={profile} onSave={onSave} />}
        extraFields={
          <div className={styles.subField}>
            <div className="field" style={{ maxWidth: 220 }}>
              <label htmlFor="fr-goal">Goal</label>
              <div className="affix has-pre">
                <span className="affix-pre">$</span>
                <NumberInput id="fr-goal" min={1} value={fr.goal} onCommit={(n) => patchFr({ goal: n })} />
              </div>
            </div>

            <div className={styles.avatarRow}>
              <div className={styles.avatarPreview} style={{ borderRadius: 12, background: "transparent", overflow: "hidden" }}>
                {fr.fillImage ? (
                  <img src={fr.fillImage} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <CrownBadge size={44} />
                )}
              </div>
              <div className={styles.avatarControls}>
                <button type="button" className="btn-outline" onClick={() => fillFileRef.current?.click()}>
                  <UploadIcon /> {fr.fillImage ? "Replace picture" : "Progress picture"}
                </button>
                {fr.fillImage && (
                  <button type="button" className="btn-outline" onClick={() => patchFr({ fillImage: "" })}>
                    Reset
                  </button>
                )}
                <input
                  ref={fillFileRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    openFillCrop(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </div>
            </div>
          </div>
        }
      />

      {cropSrc && (
        <CropModal
          imageSrc={cropSrc}
          onConfirm={(dataUrl) => {
            closeFillCrop();
            patchFr({ fillImage: dataUrl });
          }}
          onCancel={closeFillCrop}
          onReupload={openFillCrop}
        />
      )}
    </>
  );
}
