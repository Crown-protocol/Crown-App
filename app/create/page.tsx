"use client";

import { useEffect, useState } from "react";
import { safeId } from "@/lib/id";
import { useRouter } from "next/navigation";
import { useProfile } from "@/lib/data/ProfileProvider";
import { markProved } from "@/lib/data/proveOwnership";
import { isValidAddress } from "@/lib/chain/config";
import { useWallet } from "@/lib/chain/useWallet";
import { useCheer } from "@/lib/data/DataProvider";
import { TopNav } from "@/components/TopNav";
import { SocialIcon, SOCIAL_LABEL, SOCIAL_KINDS, SOCIAL_BRAND } from "@/components/icons";
import { SOCIAL_EXAMPLE, isSocialValid, sanitizeSocials } from "@/lib/data/social-links";
import { TierEditor, defaultTiers } from "@/components/TierEditor";
import { CropModal } from "@/components/CropModal";
import { WalletModal } from "@/components/WalletModal";
import { toHandle } from "@/lib/translit";
import type { Social, Tier } from "@/lib/data/types";
import styles from "./page.module.css";

const STEPS = ["Profile", "Socials", "Wallet", "Tiers"];

const short = (a: string) => (a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a);

export default function CreatePage() {
  const router = useRouter();
  const { save } = useProfile();
  const wallet = useWallet();

  const [step, setStep] = useState(1);
  // Which way we're travelling, so the incoming step slides in from that side.
  const [dir, setDir] = useState<1 | -1>(1);
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [handleEdited, setHandleEdited] = useState(false);
  const [socials, setSocials] = useState<Social[]>([{ kind: "youtube", url: "" }]);
  const [walletMode, setWalletMode] = useState<"connected" | "manual">("connected");
  const [manualAddr, setManualAddr] = useState("");
  const [tiers, setTiers] = useState<Tier[]>(defaultTiers);

  // Avatar (ported from bobounty): pick a file → crop in a full-screen modal → keep the cropped
  // 256×256 as a data URL. cropSrc is the object URL the modal is currently cropping.
  const [avatarUrl, setAvatarUrl] = useState("");
  const [cropSrc, setCropSrc] = useState("");
  // Same Aave-style wallet picker as the donation pages — opens Phantom/Solflare (with install
  // links when none is present). The old bare wallet.connect() silently did nothing with no wallet.
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  // Publishing the page to the Cheer DB (registration must not claim success until the server has it).
  const [publishing, setPublishing] = useState(false);
  const [publishErr, setPublishErr] = useState("");

  function pickAvatar(file: File | undefined) {
    if (!file || !file.type.startsWith("image/")) return;
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc(URL.createObjectURL(file));
  }
  function onCropConfirm(dataUrl: string) {
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc("");
    setAvatarUrl(dataUrl);
  }
  function onCropCancel() {
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc("");
  }

  // Real host for the link prefix (localhost in dev, the domain in prod) — resolved after mount
  // so SSR and the client agree.
  const [host, setHost] = useState("");
  useEffect(() => setHost(window.location.host), []);

  const cleanHandle = handle.trim().replace(/^@/, "").toLowerCase();
  // Built-in demo handles (/@nova) live in code, not the DB — the server refuses them (409), so
  // catch it here with a normal field error instead of a silently dead link.
  const reserved = false; // no handles are held back any more — the demo creator is gone
  const canNext1 = name.trim().length > 0 && cleanHandle.length > 0 && !reserved;
  // A filled-in social link must be a real profile URL on its platform (anti-phishing) before moving on.
  const canNext2 = socials.every((s) => !s.url.trim() || isSocialValid(s.kind, s.url));

  // Base58 Solana pubkey (32 bytes) — the payout address format of the Cheer backend.
  const manualValid = isValidAddress(manualAddr);

  /** Why "Next" is off, in the words of what is missing — or "" when it is on. */
  function nextBlocker(): string {
    if (step === 1) {
      if (!name.trim()) return "A name is needed to continue.";
      if (!cleanHandle) return "Pick a link for your page to continue.";
      if (reserved) return "That link is taken — pick another.";
    }
    if (step === 2 && !canNext2) return "One of the links is not a profile URL on its platform.";
    if (step === 3 && !canFinish) return "A payout address is needed to continue.";
    return "";
  }

  function resolvedAddress(): string {
    if (walletMode === "manual") return manualAddr.trim() || "";
    return wallet.address || "";
  }

  const addr = resolvedAddress();

  // A real, well-formed destination is required before finishing (a bad/empty address would make the
  // streamer's own /@handle 404 and route donations nowhere).
  // A REAL payout address also needs the wallet's signature: the server refuses an unsigned page
  // with a real address (anti-squatting), so finishing without a connected wallet would "save"
  // locally and silently never publish — the public link would be dead in every other browser.
  const manualNeedsWallet = walletMode === "manual" && manualValid && !wallet.connected;
  const canFinish =
    walletMode === "manual" ? manualValid && !manualNeedsWallet : isValidAddress(wallet.address ?? "");

  const nextBlockedBy = nextBlocker();

  // Every step change goes through here so `dir` and `step` always agree.
  function go(to: number) {
    setDir(to > step ? 1 : -1);
    setStep(to);
  }

  async function finish() {
    if (publishing) return;
    setPublishing(true);
    setPublishErr("");
    const parsedTiers = tiers.filter((t) => t.name.trim()).map((t) => ({ ...t, name: t.name.trim() }));
    // Wait for the SERVER copy. A page that only made it into localStorage is invisible to every other
    // browser (its /@handle 404s, and signing in elsewhere says "no account") — telling the user
    // "you're registered" in that state is a lie that costs them their handle.
    const res = await save({
      handle: cleanHandle,
      name: name.trim(),
      address: addr,
      socials: sanitizeSocials(socials),
      tiers: parsedTiers.length ? parsedTiers : defaultTiers(),
      ...(avatarUrl ? { avatarEnabled: true, avatarUrl } : {}),
    });
    setPublishing(false);
    // Only count this as proof of ownership if the wallet REALLY signed. A demo-address page publishes
    // without a signature, and stamping a proof for it handed the "this wallet proved itself" flag to a
    // wallet that never signed anything.
    if (res.ok && res.signed) markProved(wallet.address);
    if (!res.ok) {
      setPublishErr(
        res.reason === "unsigned"
          ? "Your wallet didn't sign the page, so it wasn't published. Approve the signature request and press Finish again."
          : res.reason === "taken"
            ? "That handle is already taken — pick another one."
            : "Couldn't reach Cheer to publish your page. Check your connection and press Finish again."
      );
      return;
    }
    // A demo-address page has no wallet to prove ownership with, so the cabinet gate (which signs a
    // wallet in OR accepts a demo session) would otherwise bounce us back to /create. Mark the demo
    // session here so /space recognises the just-created page and lands in the cabinet.
    router.push("/space");
  }

  return (
    <main className={styles.wrap} data-step={step}>
      {/* the one accent glow — drifts across as you advance, tinting the screen a touch */}
      <div className={styles.glow} aria-hidden />

      <TopNav />

      <div className={styles.main}>
        <div className={styles.head}>
          <h1>Create your page</h1>
          <p>Free — one page per wallet.</p>
        </div>

        <ol className={styles.steps}>
          {STEPS.map((s, i) => {
            const n = i + 1;
            const state = n === step ? styles.stepOn : n < step ? styles.stepDone : "";
            return (
              <li key={s} className={styles.item}>
                <span className={`${styles.step} ${state}`} aria-current={n === step ? "step" : undefined}>
                  <span className={styles.num}>{n < step ? "✓" : n}</span>
                  <span className={styles.label}>{s}</span>
                </span>
                {n < STEPS.length && <span className={`${styles.bar}${n < step ? " " + styles.barOn : ""}`} />}
              </li>
            );
          })}
        </ol>

        <div className={`card ${styles.card} ${dir === 1 ? styles.cardNext : styles.cardPrev}`} key={step}>
          {step === 1 && (
            <>
              <div className={styles.avatarStep}>
                {avatarUrl ? (
                  <div className={styles.avatarPreview}>
                    <img src={avatarUrl} alt="Your avatar" />
                    <button type="button" className={styles.avatarRemove} aria-label="Remove photo" onClick={() => setAvatarUrl("")}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ) : (
                  <label className={styles.avatarDrop}>
                    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
                    </svg>
                    <span>Photo</span>
                    <input type="file" accept="image/*" hidden onChange={(e) => pickAvatar(e.target.files?.[0])} />
                  </label>
                )}
              </div>

              <div className="field">
                <label htmlFor="w-name">Name</label>
                <input
                  id="w-name"
                  type="text"
                  placeholder="What people call you on stream"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (!handleEdited) setHandle(toHandle(e.target.value));
                  }}
                />
              </div>

              {/* the field is the link — no separate "your link" line to read */}
              <div className="field">
                <label htmlFor="w-handle">Your page link</label>
                <div className={styles.linkField}>
                  <span className={styles.linkPrefix}>{host || "cheer.tv"}/@</span>
                  <input
                    id="w-handle"
                    type="text"
                    placeholder="handle"
                    value={handle}
                    onChange={(e) => {
                      setHandleEdited(true);
                      setHandle(toHandle(e.target.value));
                    }}
                  />
                </div>
                {name.trim() && !cleanHandle && <div className={styles.err}>Use latin letters or digits.</div>}
                {reserved && <div className={styles.err}>This handle is taken.</div>}
              </div>

            </>
          )}

          {step === 2 && (
            <>
              {socials.map((s, i) => (
                <div className="social-row" key={s.id ?? `i${i}`}>
                  <span className="ic" style={{ background: SOCIAL_BRAND[s.kind].bg, color: SOCIAL_BRAND[s.kind].fg }}>
                    <SocialIcon kind={s.kind} />
                  </span>
                  <div className={styles.socialFields}>
                    <select
                      className="chip"
                      style={{ height: 48, padding: "0 12px", borderRadius: "var(--r-2)", background: "var(--bg-0)" }}
                      value={s.kind}
                      onChange={(e) => setSocials((p) => p.map((x, j) => (j === i ? { ...x, kind: e.target.value as Social["kind"] } : x)))}
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
                        onChange={(e) => setSocials((p) => p.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
                      />
                      {s.url.trim() && !isSocialValid(s.kind, s.url) && (
                        <div className={styles.err}>Enter a real {SOCIAL_LABEL[s.kind]} link.</div>
                      )}
                    </div>
                  </div>
                  <button className="rm" type="button" aria-label="Remove" onClick={() => setSocials((p) => p.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </div>
              ))}
              {socials.length < SOCIAL_KINDS.length && (
                <button className="btn-outline" type="button" style={{ alignSelf: "flex-start" }} onClick={() => setSocials((p) => [...p, { kind: "twitch", url: "", id: safeId() }])}>
                  + Add link
                </button>
              )}
            </>
          )}

          {step === 3 && (
            <>
              <div className={styles.opts}>
                <button type="button" className={`${styles.opt}${walletMode === "connected" ? " " + styles.optOn : ""}`} onClick={() => setWalletMode("connected")}>
                  <span className={styles.mark} aria-hidden />
                  <span className={styles.optBody}>
                    <span className={styles.optTitle}>Connected wallet</span>
                    <span className={`${styles.optAddr} num`}>
                      {wallet.connected ? short(wallet.address ?? "") : "Not connected"}
                    </span>
                  </span>
                </button>

                {walletMode === "connected" && !wallet.connected && (
                  <button className="btn" type="button" style={{ alignSelf: "flex-start" }} onClick={() => setWalletModalOpen(true)}>
                    {wallet.connecting ? "Opening wallet…" : "Connect wallet"}
                  </button>
                )}

                <button type="button" className={`${styles.opt}${walletMode === "manual" ? " " + styles.optOn : ""}`} onClick={() => setWalletMode("manual")}>
                  <span className={styles.mark} aria-hidden />
                  <span className={styles.optBody}>
                    <span className={styles.optTitle}>Another address</span>
                  </span>
                </button>

                {walletMode === "manual" && (
                  <div className="field">
                    <input
                      type="text"
                      placeholder="Solana address, e.g. 7xKX…"
                      value={manualAddr}
                      aria-invalid={!!manualAddr.trim() && !manualValid}
                      style={manualAddr.trim() && !manualValid ? { borderColor: "var(--error)" } : undefined}
                      onChange={(e) => setManualAddr(e.target.value)}
                    />
                    {manualAddr.trim() && !manualValid && <div className={styles.err}>Enter a valid Solana address (base58).</div>}
                    {manualNeedsWallet && (
                      <>
                        <div className={styles.err}>Connect a wallet to sign the page — donations still go to this address.</div>
                        <button className="btn" type="button" style={{ alignSelf: "flex-start", marginTop: 8 }} onClick={() => setWalletModalOpen(true)}>
                          {wallet.connecting ? "Opening wallet…" : "Connect wallet"}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* money-critical, so it gets a real notice — not grey fine print */}
              <div className="notice">Donations land here directly. Cheer never holds them, so a wrong address can&apos;t be undone.</div>
            </>
          )}

          {step === 4 && (
            <>
              <TierEditor initialTiers={tiers} onChange={setTiers} />
              <div className="notice">
                <b>$1 donated = 1 point.</b> Defaults are fine — you can rename tiers any time.
              </div>
            </>
          )}
        </div>

        <div className={styles.nav}>
          <button className={styles.back} type="button" onClick={() => (step === 1 ? router.push("/") : go(step - 1))}>
            ← Back
          </button>
          {publishErr && (
            <div className="error-note" role="alert" style={{ flex: "1 1 100%", order: -1 }}>
              {publishErr}
            </div>
          )}
          <div className={styles.navRight}>
            {(step === 2 || step === 4) && (
              <button
                className={styles.skip}
                type="button"
                disabled={(step === 4 && !canFinish) || publishing}
                onClick={() => {
                  if (step === 4) return void finish();
                  // Skipping socials shouldn't smuggle a half-typed invalid link forward — drop
                  // the invalid/empty ones now, the same clean-up finish() would do anyway.
                  if (step === 2) setSocials(sanitizeSocials(socials));
                  go(step + 1);
                }}
              >
                Skip
              </button>
            )}
            {step < 4 ? (
              <>
                {/* A dead "Next" with nothing beside it is the worst state this
                    wizard can be in: the visitor is stopped and not told by
                    what. The reason is spelled out next to the button rather
                    than left to be inferred from a field that looks fine. */}
                {nextBlockedBy && <span className={styles.navNote}>{nextBlockedBy}</span>}
                <button
                  className="btn"
                  type="button"
                  disabled={!!nextBlockedBy || publishing}
                  onClick={() => go(step + 1)}
                >
                  Next
                </button>
              </>
            ) : (
              <>
                {!canFinish && <span className={styles.navNote}>A payout address is needed to publish.</span>}
                <button className="btn" type="button" disabled={!canFinish || publishing} onClick={() => void finish()}>
                  {publishing ? "Publishing…" : "Done"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {cropSrc && <CropModal imageSrc={cropSrc} onConfirm={onCropConfirm} onCancel={onCropCancel} onReupload={(f) => pickAvatar(f)} />}
      {walletModalOpen && <WalletModal onClose={() => setWalletModalOpen(false)} />}
    </main>
  );
}
