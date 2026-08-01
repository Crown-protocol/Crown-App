"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import { UploadIcon, CopyIcon, QrIcon, SocialIcon, SOCIAL_LABEL, SOCIAL_KINDS, SOCIAL_BRAND } from "@/components/icons";
import { SOCIAL_EXAMPLE, isSocialValid } from "@/lib/data/social-links";
import { isValidAddress } from "@/lib/chain/config";
import { isDemoAddress } from "@/lib/data/session";
import { TierEditor } from "@/components/TierEditor";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import pageBuilderStyles from "@/components/PageBuilder.module.css";
import styles from "./SettingsPanel.module.css";
import type { Profile, Social } from "@/lib/data/types";

// Which top-level pieces of the page a settings edit can touch — the confirm bar counts THESE
// (a changed field group = 1 change), not keystrokes.
const DIFF_FIELDS: { key: keyof Profile; label: string }[] = [
  { key: "name", label: "name" },
  { key: "avatarUrl", label: "photo" },
  { key: "socials", label: "socials" },
  { key: "address", label: "payout address" },
  { key: "tiers", label: "tiers" },
];

// Settings — identity first (who you are + your live link, with copy/open/QR), then socials,
// the money (payout address, VALIDATED), tiers, a data backup, and finally session + the one
// destructive action. Edits collect in a local DRAFT; nothing reaches the page or the server
// until "Confirm changes (n)" — so a slipped keystroke in the payout address can't go live.
export function SettingsPanel({
  profile,
  walletAddress,
  onSave,
  onDelete,
  onLogOut,
}: {
  profile: Profile;
  // The connected wallet's own address (your login), when a real wallet is connected. Distinct from
  // profile.address, which is where donations are PAID — usually the same, but the payout field is
  // editable, so we show the actual signed-in wallet separately.
  walletAddress?: string;
  onSave: (p: Profile) => void;
  // Async: deleting must reach the server before the dialog closes (a background delete used to
  // be killed by the navigation, leaving the page alive in the DB).
  onDelete: () => void | Promise<{ ok: boolean; reason?: string } | void>;
  onLogOut: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirm, setConfirm] = useState<"logout" | "delete" | null>(null);
  const [copied, setCopied] = useState<"link" | "payout" | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [qr, setQr] = useState("");

  // The draft: what the form shows. `base`: what's actually saved. Confirm promotes draft → base
  // (and up through onSave); Discard rolls the draft back. TierEditor keeps internal state, so a
  // discard remounts it via resetKey.
  const [base, setBase] = useState<Profile>(profile);
  const [draft, setDraft] = useState<Profile>(profile);
  const [resetKey, setResetKey] = useState(0);
  // The confirm bar portals to <body> so its fixed positioning centres on the viewport; client-only.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // The parent saved/changed the profile elsewhere (e.g. right after our own confirm round-trips):
  // adopt it as the new baseline — but never while the user has unconfirmed edits.
  useEffect(() => {
    const dirtyNow = JSON.stringify(draft) !== JSON.stringify(base);
    if (!dirtyNow && JSON.stringify(profile) !== JSON.stringify(base)) {
      setBase(profile);
      setDraft(profile);
      setResetKey((k) => k + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  function patch(next: Partial<Profile>) {
    setDraft((d) => ({ ...d, ...next }));
  }

  const changedFields = DIFF_FIELDS.filter((f) => JSON.stringify(draft[f.key] ?? null) !== JSON.stringify(base[f.key] ?? null));
  const changes = changedFields.length;
  // A garbage payout address must not be confirmable — that typo costs real money.
  const draftPayout = draft.address.trim();
  const draftPayoutValid = isDemoAddress(draftPayout) || isValidAddress(draftPayout);

  function confirmChanges() {
    if (!changes || !draftPayoutValid) return;
    onSave(draft);
    setBase(draft);
  }

  function discardChanges() {
    setDraft(base);
    setResetKey((k) => k + 1);
  }

  // Real host after mount (localhost in dev, the domain in prod) — SSR and client must agree.
  const [host, setHost] = useState("");
  useEffect(() => setHost(window.location.host), []);
  const pageUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/@${profile.handle}`;
  const pageLabel = `${host || "crown.tv"}/@${profile.handle}`;

  useEffect(() => {
    if (!qrOpen) return;
    QRCode.toDataURL(pageUrl, { margin: 1, width: 200, color: { dark: "#F1EFF7", light: "#00000000" } })
      .then(setQr)
      .catch(() => setQr(""));
  }, [qrOpen, pageUrl]);

  async function copy(what: "link" | "payout", text: string) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1600);
    } catch {}
  }

  const MAX_AVATAR_BYTES = 4 * 1024 * 1024; // avatars are baked into the profile as a data URL — cap it

  function onAvatarFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same file be re-picked after a rejection
    if (!file || !file.type.startsWith("image/") || file.size > MAX_AVATAR_BYTES) return;
    const reader = new FileReader();
    reader.onload = () => patch({ avatarUrl: String(reader.result), avatarEnabled: true });
    reader.onerror = () => {};
    reader.readAsDataURL(file);
  }

  function addSocial() {
    patch({ socials: [...draft.socials, { kind: "twitch", url: "", id: crypto.randomUUID() }] });
  }
  function updateSocial(i: number, next: Partial<Social>) {
    patch({ socials: draft.socials.map((s, j) => (j === i ? { ...s, ...next } : s)) });
  }
  function removeSocial(i: number) {
    patch({ socials: draft.socials.filter((_, j) => j !== i) });
  }

  const payoutDemo = isDemoAddress(draftPayout);
  const loginDiffers = !!walletAddress && !payoutDemo && walletAddress !== draftPayout;

  // Backup: the SAVED page (not the draft) as a JSON download — what's actually live is yours.
  function exportProfile() {
    const blob = new Blob([JSON.stringify(base, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `crown-${profile.handle}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const short = (a: string) => (a.length > 16 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

  return (
    <div className={styles.stack}>
      {/* ── Your page ── */}
      <div className={`card ${styles.card}`}>
        <div className={styles.head}>
          <h2 className={styles.title}>Your page</h2>
          <span className={styles.sub}>The link viewers get. The handle itself can&apos;t change once the page exists.</span>
        </div>

        <div className={styles.identity}>
          <div className={styles.avatarWrap}>
            <button
              type="button"
              className={styles.avatar}
              style={draft.avatarUrl ? { backgroundImage: `url(${draft.avatarUrl})` } : undefined}
              onClick={() => fileRef.current?.click()}
              aria-label={draft.avatarUrl ? "Change photo" : "Upload photo"}
              title={draft.avatarUrl ? "Change photo" : "Upload photo"}
            >
              {!draft.avatarUrl && (draft.name.trim().charAt(0) || "?")}
              <span className={styles.avatarHint} aria-hidden>
                <UploadIcon />
              </span>
            </button>
            {draft.avatarUrl && (
              <button type="button" className={styles.avatarX} onClick={() => patch({ avatarUrl: undefined })} aria-label="Remove photo" title="Remove photo">
                ✕
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={onAvatarFile} />
          </div>

          <div className={styles.identityFields}>
            <div className="field">
              <label htmlFor="set-name">Name</label>
              <input id="set-name" type="text" value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
            </div>

            <div className={styles.linkRow}>
              <span className={styles.linkText}>{pageLabel}</span>
              <button type="button" className={styles.linkBtn} onClick={() => copy("link", pageUrl)}>
                <CopyIcon /> {copied === "link" ? "Copied!" : "Copy"}
              </button>
              <a className={styles.linkBtn} href={`/@${profile.handle}`} target="_blank" rel="noreferrer">
                Open
              </a>
              <button type="button" className={styles.linkBtn} onClick={() => setQrOpen((v) => !v)} aria-expanded={qrOpen}>
                <QrIcon /> QR
              </button>
            </div>

            {qrOpen && qr && (
              <div className={styles.qrBox}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qr} alt={`QR code for ${pageLabel}`} width={200} height={200} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Socials ── */}
      <div className={`card ${styles.card}`}>
        <div className={styles.head}>
          <h2 className={styles.title}>Socials</h2>
          <span className={styles.sub}>Shown on your page — only links that verify as real profiles render.</span>
        </div>
        {draft.socials.map((s, i) => (
          <div className="social-row" key={s.id ?? `i${i}`}>
            <span className="ic" style={{ background: SOCIAL_BRAND[s.kind].bg, color: SOCIAL_BRAND[s.kind].fg }}>
              <SocialIcon kind={s.kind} />
            </span>
            <div className={pageBuilderStyles.socialFields}>
              <select
                className="chip"
                style={{ height: 48, padding: "0 12px", borderRadius: "var(--r-2)", background: "var(--bg-0)" }}
                value={s.kind}
                onChange={(e) => updateSocial(i, { kind: e.target.value as Social["kind"] })}
              >
                {SOCIAL_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {SOCIAL_LABEL[k]}
                  </option>
                ))}
              </select>
              <div className="field">
                <input
                  type="text"
                  placeholder={SOCIAL_EXAMPLE[s.kind]}
                  value={s.url}
                  aria-invalid={!!s.url.trim() && !isSocialValid(s.kind, s.url)}
                  style={s.url.trim() && !isSocialValid(s.kind, s.url) ? { borderColor: "var(--error)" } : undefined}
                  onChange={(e) => updateSocial(i, { url: e.target.value })}
                />
                {s.url.trim() && !isSocialValid(s.kind, s.url) && (
                  <div className="footnote" style={{ color: "var(--error)" }}>
                    Enter your {SOCIAL_LABEL[s.kind]} link, e.g. {SOCIAL_EXAMPLE[s.kind]}
                  </div>
                )}
              </div>
            </div>
            <button className="rm" type="button" aria-label="Remove" onClick={() => removeSocial(i)}>
              ✕
            </button>
          </div>
        ))}
        {draft.socials.length < SOCIAL_KINDS.length && (
          <button className="btn-outline" type="button" style={{ alignSelf: "flex-start" }} onClick={addSocial}>
            + Add link
          </button>
        )}
      </div>

      {/* ── Payouts ── */}
      <div className={`card ${styles.card}`}>
        <div className={styles.head}>
          <h2 className={styles.title}>Payouts</h2>
          <span className={styles.sub}>Donations land here directly — Crown never holds them, so a wrong address can&apos;t be undone.</span>
        </div>

        <div className="field">
          <label htmlFor="set-wallet">Payout address</label>
          <div className={styles.addrRow}>
            <input
              id="set-wallet"
              type="text"
              placeholder="Solana address, e.g. 7xKX…"
              value={draft.address}
              aria-invalid={!draftPayoutValid}
              style={!draftPayoutValid ? { borderColor: "var(--error)" } : undefined}
              onChange={(e) => patch({ address: e.target.value })}
            />
            <button
              type="button"
              className="btn-outline"
              onClick={() => copy("payout", draftPayout)}
              disabled={!draftPayout}
              aria-label="Copy payout address"
              style={{ flex: "none", gap: 6 }}
            >
              <CopyIcon /> {copied === "payout" ? "Copied!" : "Copy"}
            </button>
          </div>
          {/* live validation — the one place a typo costs real money */}
          {!draftPayoutValid ? (
            <div className={`${styles.addrState} ${styles.addrBad}`}>Not a valid Solana address — donations would go nowhere.</div>
          ) : payoutDemo ? (
            <div className={`${styles.addrState} ${styles.addrOk}`}>Demo placeholder — set a real address before taking real money.</div>
          ) : null}
        </div>

        {walletAddress && (
          <div className={styles.loginRow}>
            <span>
              Signed in as <span className={styles.loginAddr}>{short(walletAddress)}</span>
            </span>
            {loginDiffers && (
              <button type="button" className={styles.inlineAct} onClick={() => patch({ address: walletAddress })}>
                Use this wallet for payouts
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Tiers ── */}
      <div className={`card ${styles.card}`}>
        <div className={styles.head}>
          <h2 className={styles.title}>Tiers</h2>
          <span className={styles.sub}>1 point = $1 donated. Applies after you confirm below.</span>
        </div>
        <TierEditor key={resetKey} initialTiers={draft.tiers ?? []} onChange={(tiers) => patch({ tiers })} />
      </div>

      {/* ── Data ── */}
      <div className={`card ${styles.card}`}>
        <div className={styles.head}>
          <h2 className={styles.title}>Your data</h2>
          <span className={styles.sub}>Everything that makes your page — name, tiers, game setups — in one file.</span>
        </div>
        <button className="btn-outline" type="button" style={{ alignSelf: "flex-start" }} onClick={exportProfile}>
          Download backup (JSON)
        </button>
      </div>

      {/* ── Session & the one destructive action ── */}
      <div className={`card ${styles.card}`}>
        <div className={styles.head}>
          <h2 className={styles.title}>Session</h2>
          <span className={styles.sub}>Your wallet is your login. Signing out changes nothing on your page.</span>
        </div>
        <div className={styles.rowSplit}>
          <button className="btn-outline" type="button" onClick={() => setConfirm("logout")}>
            Log out
          </button>
        </div>
        <div className={styles.divider} />
        <div className={styles.rowSplit}>
          <span className={styles.sub}>Erases the page here and from Crown — the public link dies. No undo.</span>
          <button className={styles.danger} type="button" onClick={() => setConfirm("delete")}>
            Delete page
          </button>
        </div>
      </div>

      {/* ── the confirm bar: only while the draft differs from the saved page. Portalled to <body>
             so its fixed positioning centres on the viewport, not a transformed ancestor. ── */}
      {changes > 0 && mounted &&
        createPortal(
          <div className={styles.saveBar}>
            <span className={styles.saveBarNote}>
              {draftPayoutValid ? "Nothing is live until you confirm." : "Fix the payout address to confirm."}
            </span>
            <button className={styles.discard} type="button" onClick={discardChanges}>
              Discard
            </button>
            <button className={styles.saveConfirm} type="button" disabled={!draftPayoutValid} onClick={confirmChanges}>
              Confirm changes ({changes})
            </button>
          </div>,
          document.body
        )}

      {confirm === "logout" && (
        <ConfirmDialog
          title="Log out?"
          confirmLabel="Log out"
          onCancel={() => setConfirm(null)}
          onConfirm={onLogOut}
          body={
            // A demo page has no owning wallet, so "connect the same wallet again" is a promise this
            // build cannot keep for it: there is nothing to connect, and sign-in resolves accounts by
            // owner — a lookup that can never match a page nobody owns. Signing out of one is
            // one-way, so say so BEFORE the click rather than leaving them on the registration wizard
            // wondering where their page went.
            isDemoAddress(draft.address) ? (
              <>
                <b>This is a one-way door.</b> This page was created in demo mode, so no wallet owns it — there is
                nothing to sign back in with, and logging out here gives up access to it for good. The page itself
                keeps working at <b>/@{draft.handle}</b>. Want an account you can return to? Connect a wallet and
                register a page with it.
              </>
            ) : (
              <>
                You&apos;ll be signed out and your wallet disconnected. <b>Your page, tiers and game settings stay
                exactly as they are</b> — connect the same wallet again to pick up where you left off.
              </>
            )
          }
        />
      )}

      {confirm === "delete" && (
        <ConfirmDialog
          title="Delete your page?"
          confirmLabel="Delete page"
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={onDelete}
          busyLabel="Deleting…"
          errorText={(reason) =>
            reason === "unsigned"
              ? "Your wallet didn't sign the delete, so nothing was removed. Approve the signature request and try again."
              : "Couldn't reach Crown to delete your page. Check your connection and try again."
          }
          body={
            <>
              Your page, tiers and game settings are erased — here and from Crown, so your public link
              stops working. <b>This can&apos;t be undone.</b>
            </>
          }
        />
      )}
    </div>
  );
}
