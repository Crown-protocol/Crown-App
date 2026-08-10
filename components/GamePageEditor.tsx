"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { safeId } from "@/lib/id";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import {
  QrIcon,
  CopyIcon,
  PhoneIcon,
  DesktopIcon,
  ChevronDown,
  SocialIcon,
  SOCIAL_LABEL,
  SOCIAL_KINDS,
  SOCIAL_BRAND,
} from "@/components/icons";
import { LivePreview } from "@/components/LivePreview";
import { postPreviewPatch, PREVIEW_MSG, type PreviewPatch } from "@/lib/data/previewOverlay";
import { DesignTab } from "@/components/DesignTab";
import { SOCIAL_EXAMPLE, isSocialValid } from "@/lib/data/social-links";
import { activeSessions, getCurrentSession, pullSessions, type GameSession } from "@/lib/data/gameSessions";
import type { GameId } from "@/lib/data/games";
import type { PageDesign, PageWidget, Profile, Social } from "@/lib/data/types";
import styles from "./PageBuilder.module.css";

// ── The one builder behind all four mini-games ──────────────────────────────────────────────
// Task, Roulette, Fundraiser and Auction used to be four near-identical 330-line copies of this
// file, which is exactly how they drifted apart. Now each game passes a small config (its words,
// its limits, its draft) and gets the same three tabs: Page · Rules · Design.
//
// The structure the owner asked for: the editor reads top-to-bottom as the page itself does —
// who you are → what you're asking for → what viewers pay → optional extras. The knobs that
// aren't cosmetic (minimum amounts, deadlines) live one tab over under "Rules", so a maker
// setting up a game never has to hunt in the sidebar for the half of it that costs money.

export type GameEditorTab = "page" | "rules" | "design";
type Device = "phone" | "desktop";

// Everything a game contributes to the shared editor: its words, its limits, and how to read and
// write its own draft. Anything that differs between the four games goes here — nothing else.
export interface GameEditorConfig {
  /** URL segment and preview target: /@handle/<slug> */
  slug: string;
  /** Tab label + aria label for the whole builder, e.g. "Task". */
  title: string;
  /** Label under the preview, e.g. "Task link". */
  linkLabel: string;
  /** File name for the downloaded QR PNG. */
  qrFileName: string;
  /** What the headline field is called on this page ("Headline" / "Your pledge"). */
  headlineLabel: string;
  headlinePlaceholder: string;
  headlineMax: number;
  descriptionPlaceholder: string;
  descriptionMax: number;
  /** What the money the viewer sends is called here — "task", "suggestion", "chip-in", "bid". */
  amountsTitle: string;
  maxPresets: number;
  /** The pay form's name on this page ("Task form", "Chip-in form", …). */
  formLabel: string;
}

// The live draft values the editor edits, plus the setters back into the game's own draft.
export interface GameEditorDraft {
  headline: string;
  description: string;
  descriptionEnabled: boolean;
  presets: number[];
  widgets: PageWidget[];
  design: PageDesign;
}

export function GamePageEditor({
  profile,
  onSave,
  config,
  draft,
  patchDraft,
  rules,
  extraFields,
  minAmount,
}: {
  profile: Profile;
  onSave: (p: Profile) => void;
  config: GameEditorConfig;
  draft: GameEditorDraft;
  /** Writes a partial back into this game's own draft slice. `onto` lets a confirm apply page
   *  edits and shared-profile edits (socials) in a single save. */
  patchDraft: (next: Partial<GameEditorDraft> & Record<string, unknown>, onto?: Profile) => void;
  /** The game's rules panel — the same component the sidebar's Settings item renders. */
  rules: ReactNode;
  /** Game-specific page fields (Fundraiser's goal + fill image) rendered under the description. */
  extraFields?: ReactNode;
  /** The minimum this game accepts (from its Rules tab). Amount chips below it are flagged here,
   *  so a maker can't leave a $10 chip on a page whose Rules refuse anything under $50. */
  minAmount?: number;
}) {
  const [tab, setTab] = useState<GameEditorTab>("page");
  const [device, setDevice] = useState<Device>("phone");
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [socialsOpen, setSocialsOpen] = useState(false);

  // Unconfirmed edits: null = nothing staged. Keyed by what's edited here — the game's own draft
  // and the shared socials list, which lives on the profile.
  const [pendingDraft, setPendingDraft] = useState<Partial<GameEditorDraft> | null>(null);
  const [pendingSocials, setPendingSocials] = useState<Social[] | null>(null);

  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  // Show unconfirmed edits in the preview frame — and ONLY there. Nothing is written until Confirm,
  // so the real page keeps showing the last confirmed version while you're still writing this one.
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  // The confirm bar is portalled to <body> (below), so `position: fixed` centres on the viewport and
  // isn't captured by a transformed ancestor. Only mount the portal client-side.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // Live sessions for this game. With two or more running, the bare /@handle/slug link can't resolve
  // which one a viewer means — the public page answers it with a "Pick a session" screen, which is
  // exactly what the preview here was showing. So the builder picks one and every link it hands out
  // (address bar, Copy, QR, preview) carries that session's ?s=<id>.
  // The slug IS the game id for all four games (task/roulette/fundraiser/auction) — no separate field
  // to keep in step across the four panels.
  const gameId = config.slug as GameId;
  const [sessions, setSessions] = useState<GameSession[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  useEffect(() => {
    const read = () => {
      const live = activeSessions(profile.handle, gameId);
      setSessions(live);
      // Default to the session the cabinet is already looking at, else the first live one. Re-checked
      // on every pull so a session started (or ended) in another tab lands here too.
      setSessionId((cur) => {
        if (cur && live.some((s) => s.id === cur)) return cur;
        return getCurrentSession(profile.handle, gameId)?.id ?? live[0]?.id ?? null;
      });
    };
    read();
    void pullSessions(profile.handle, gameId).then(read);
    const t = setInterval(read, 3000);
    return () => clearInterval(t);
  }, [profile.handle, gameId]);

  // Only qualify the link when there's an actual choice to make: one session (or none, on a page that
  // predates sessions) resolves on its own, and a bare link is the nicer thing to share.
  const linkSession = sessions.length > 1 ? sessions.find((s) => s.id === sessionId) ?? null : null;
  const path = `/@${profile.handle}/${config.slug}${linkSession ? `?s=${encodeURIComponent(linkSession.id)}` : ""}`;
  const link = `${origin || "https://cheer.tv"}${path}`;

  useEffect(() => {
    if (!qrOpen) return;
    QRCode.toDataURL(link, { margin: 1, width: 240, color: { dark: "#F1EFF7", light: "#00000000" } })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(""));
  }, [qrOpen, link]);

  // What the editor shows: the saved draft with any unconfirmed edits laid over it.
  const shown: GameEditorDraft = { ...draft, ...(pendingDraft ?? {}) };
  const shownSocials: Social[] = pendingSocials ?? profile.socials;

  // Stage an edit instead of saving it. Design and Rules are NOT staged — they have their own
  // immediate feel (a colour you pick, a rule you set) and confirming them would be surprising.
  function stage(next: Partial<GameEditorDraft>) {
    setPendingDraft((p) => ({ ...(p ?? {}), ...next }));
  }

  // Fundraiser stores its headline as `pledge`; the editor speaks `headline` for all four. Send the
  // draft under the name the page actually reads, or the preview would ignore it.
  const gameKey: PreviewPatch["gameKey"] =
    config.slug === "task" ? "taskPage" : (config.slug as "roulette" | "fundraiser" | "auction");
  const previewDraft: Record<string, unknown> | null = pendingDraft
    ? config.slug === "fundraiser"
      ? (({ headline, ...rest }) => ({ ...rest, ...(headline !== undefined ? { pledge: headline } : {}) }))(pendingDraft)
      : { ...pendingDraft }
    : null;

  // Push staged edits into the preview whenever they change. Serialised for the dependency list so
  // this fires on the actual content changing, not on every keystroke re-creating the object.
  const patchJson = JSON.stringify({ d: previewDraft, s: pendingSocials });
  useEffect(() => {
    const { d, s } = JSON.parse(patchJson) as { d: Record<string, unknown> | null; s: Social[] | null };
    const patch = d || s ? { handle: profile.handle, gameKey, draft: d ?? {}, ...(s ? { socials: s } : {}) } : null;
    const send = () => postPreviewPatch(frameRef.current, patch);
    send();
    // The iframe may still have been loading when we sent that — it announces itself when ready,
    // and we answer with the current patch so the first paint already carries the staged edits.
    const onReady = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if ((e.data as { type?: string } | null)?.type === `${PREVIEW_MSG}:ready`) send();
    };
    window.addEventListener("message", onReady);
    return () => window.removeEventListener("message", onReady);
  }, [patchJson, profile.handle, gameKey]);

  const payForm = shown.widgets.find((w) => w.kind === "donate");
  const socials = shown.widgets.find((w) => w.kind === "socials");

  function patchWidget(kind: PageWidget["kind"], next: Partial<PageWidget>) {
    stage({ widgets: shown.widgets.map((w) => (w.kind === kind ? { ...w, ...next } : w)) });
  }

  function updatePreset(i: number, value: number) {
    const next = shown.presets.slice();
    next[i] = Math.max(1, Math.round(value) || 1);
    stage({ presets: next });
  }

  function addPreset() {
    const last = shown.presets[shown.presets.length - 1] ?? 5;
    stage({ presets: [...shown.presets, last + 5] });
  }

  function removePreset(i: number) {
    if (shown.presets.length <= 1) return;
    stage({ presets: shown.presets.filter((_, j) => j !== i) });
  }

  function addSocial() {
    setPendingSocials([...shownSocials, { kind: "twitch", url: "", id: safeId() }]);
    setSocialsOpen(true);
  }

  function updateSocial(i: number, next: Partial<Social>) {
    setPendingSocials(shownSocials.map((s, j) => (j === i ? { ...s, ...next } : s)));
  }

  function removeSocial(i: number) {
    setPendingSocials(shownSocials.filter((_, j) => j !== i));
  }

  // ── Confirm / discard ──
  const dirty = pendingDraft !== null || pendingSocials !== null;
  // One count per thing the maker actually touched, so "(3)" matches what they'd list out loud.
  const changeCount =
    (pendingDraft ? Object.keys(pendingDraft).filter((k) => JSON.stringify((pendingDraft as Record<string, unknown>)[k]) !== JSON.stringify((draft as unknown as Record<string, unknown>)[k])).length : 0) +
    (pendingSocials && JSON.stringify(pendingSocials) !== JSON.stringify(profile.socials) ? 1 : 0);

  // Empty pitch = a public page with nothing above the form. Blocks the confirm, never the typing.
  const pitchMissing = !shown.headline.trim();

  function confirmChanges() {
    if (!dirty || pitchMissing) return;
    // One write, so a confirm can't half-apply: the panel merges the game's own slice, and the
    // shared socials ride along on the profile it merges into.
    const base: Profile = pendingSocials ? { ...profile, socials: pendingSocials } : profile;
    if (pendingDraft) patchDraft(pendingDraft, base);
    else onSave(base);
    setPendingDraft(null);
    setPendingSocials(null);
  }

  function discardChanges() {
    setPendingDraft(null);
    setPendingSocials(null);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {}
  }

  const TABS: { key: GameEditorTab; label: string }[] = [
    { key: "page", label: "Page" },
    { key: "rules", label: "Rules" },
    { key: "design", label: "Design" },
  ];

  return (
    <div className={styles.wrap}>
      <div className={styles.builder}>
        <div className={styles.editor}>
          {/* Tabs and session sit on one row because they answer two halves of the same question:
              WHICH session you're editing, and WHICH part of it. The session used to live over the
              preview, where it read as a preview control — but it decides what every tab here edits
              and where the link below points, so it belongs with the tabs it governs.

              A select rather than a row of chips: sessions are named by the maker ("Friday run"),
              so a chip row grew as wide as those names and wrapped once a few were running. */}
          <div className={styles.tabsRow}>
            <div className={styles.tabs} role="tablist" aria-label={`${config.title} builder`}>
              {TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.key}
                  className={tab === t.key ? styles.tabOn : ""}
                  onClick={() => setTab(t.key)}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {sessions.length > 1 && (
              <div className={styles.sessionRow}>
                <label className={styles.sessionLabel} htmlFor="preview-session">
                  Session
                </label>
                <select
                  id="preview-session"
                  className={styles.sessionSelect}
                  value={sessionId ?? ""}
                  onChange={(e) => setSessionId(e.target.value)}
                  title="Which session you're editing — it sets the preview and the link below"
                >
                  {sessions.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {tab === "page" && (
            <div className={styles.tabBody}>
              {/* Identity — your photo and name — is set once in Settings and shown on every game
                  page. It used to have a card here holding a lone "Show on page" switch; the owner
                  cut it, so the avatar simply follows the profile. Numbering below is unchanged. */}

              {/* ── 2. What you're asking for ── */}
              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <h3 className={styles.sectionTitle}>
                    {config.headlineLabel}
                    {/* Marked required only while it's empty: once written, the badge has done its
                        job and would just be noise on a finished page. */}
                    {pitchMissing && <span className={styles.required}>Required</span>}
                  </h3>
                </div>
                <div className={styles.bioBox}>
                  <textarea
                    className={`${styles.bioInput}${pitchMissing ? ` ${styles.bioInputNeeded}` : ""}`}
                    rows={2}
                    maxLength={config.headlineMax}
                    placeholder={config.headlinePlaceholder}
                    value={shown.headline}
                    aria-required
                    // Land the cursor here when there's nothing to say yet — the first thing to do
                    // on a fresh session is say what it's for.
                    autoFocus={pitchMissing}
                    onChange={(e) => stage({ headline: e.target.value })}
                  />
                  <span className={styles.charCount}>
                    {shown.headline.length}/{config.headlineMax}
                  </span>
                </div>

                <div className={styles.subField}>
                  <label className={`toggle${shown.descriptionEnabled ? " on" : ""}`}>
                    <span className="track">
                      <span className="knob" />
                    </span>
                    <input
                      type="checkbox"
                      hidden
                      checked={shown.descriptionEnabled}
                      onChange={(e) => stage({ descriptionEnabled: e.target.checked })}
                    />
                    Add a longer description
                  </label>
                  {shown.descriptionEnabled && (
                    <div className={styles.bioBox}>
                      <textarea
                        className={styles.bioInput}
                        rows={2}
                        maxLength={config.descriptionMax}
                        placeholder={config.descriptionPlaceholder}
                        value={shown.description}
                        onChange={(e) => stage({ description: e.target.value })}
                      />
                      <span className={styles.charCount}>
                        {shown.description.length}/{config.descriptionMax}
                      </span>
                    </div>
                  )}
                </div>

                {extraFields}
              </section>

              {/* ── 3. Widgets — every switchable block on the page, all the same shape ── */}
              <div className={styles.rowHead}>Widgets</div>
              <div className={styles.widgetList}>
                {/* The pay form: its settings are the amount chips. */}
                <section className={styles.widgetCard}>
                  <div className={styles.widgetHead}>
                    <button
                      type="button"
                      className={styles.widgetName}
                      aria-expanded={payForm?.enabled ? formOpen : undefined}
                      disabled={!payForm?.enabled}
                      onClick={() => setFormOpen((v) => !v)}
                    >
                      {payForm?.enabled && (
                        <ChevronDown className={`${styles.widgetChev}${formOpen ? ` ${styles.widgetChevOn}` : ""}`} />
                      )}
                      {/* Just the name. The preset amounts and the link count used to sit here in grey,
                          but both are already visible one click down — inside the panel this button
                          opens — so the row was repeating itself and the toggle beside it already
                          says whether the widget is on. */}
                      {config.formLabel}
                    </button>
                    <label className={`toggle${payForm?.enabled ? " on" : ""}`}>
                      <span className="track">
                        <span className="knob" />
                      </span>
                      <input
                        type="checkbox"
                        hidden
                        checked={!!payForm?.enabled}
                        onChange={(e) => patchWidget("donate", { enabled: e.target.checked })}
                      />
                      <span className="sr-only">Show {config.formLabel}</span>
                    </label>
                  </div>

                  {payForm?.enabled && formOpen && (
                    <div className={styles.widgetConfig}>
                      <div className={styles.widgetFieldHead}>{config.amountsTitle}</div>
<div className={styles.presetRow}>
                        {shown.presets.map((amount, pi) => {
                          const below = minAmount != null && amount < minAmount;
                          return (
                            <div className={`${styles.presetChip}${below ? ` ${styles.presetChipBad}` : ""}`} key={pi}>
                              <span className={styles.presetDollar}>$</span>
                              <input
                                type="number"
                                min={1}
                                aria-label={`Amount ${pi + 1}${below ? ` — below the $${minAmount} minimum` : ""}`}
                                aria-invalid={below || undefined}
                                value={amount}
                                onChange={(e) => updatePreset(pi, +e.target.value)}
                              />
                              {shown.presets.length > 1 && (
                                <button
                                  type="button"
                                  className={styles.presetRemove}
                                  aria-label={`Remove amount ${pi + 1}`}
                                  onClick={() => removePreset(pi)}
                                >
                                  ✕
                                </button>
                              )}
                            </div>
                          );
                        })}
                        {shown.presets.length < config.maxPresets && (
                          <button type="button" className={styles.presetAdd} aria-label="Add amount" onClick={addPreset}>
                            +
                          </button>
                        )}
                      </div>
                      {/* A chip under the game's own minimum can't actually be sent — flag it so it's fixed
                          here (or the minimum lowered in Rules), not discovered by a viewer who gets refused. */}
                      {minAmount != null && payForm?.enabled && shown.presets.some((a) => a < minAmount) && (
                        <p className={styles.presetWarn} role="alert">
                          {(() => {
                            const bad = shown.presets.filter((a) => a < minAmount);
                            const list = bad.map((a) => `$${a}`).join(", ");
                            return `${list} ${bad.length > 1 ? "are" : "is"} below your $${minAmount} minimum — viewers can't send ${
                              bad.length > 1 ? "them" : "it"
                            }. Raise ${bad.length > 1 ? "them" : "it"}, or lower the minimum in Rules.`;
                          })()}
                        </p>
                      )}
                    </div>
                  )}
                </section>

                {/* Social icons: its settings are the links themselves. Same shell as above. */}
                <section className={styles.widgetCard}>
                  <div className={styles.widgetHead}>
                    <button
                      type="button"
                      className={styles.widgetName}
                      aria-expanded={socials?.enabled ? socialsOpen : undefined}
                      disabled={!socials?.enabled}
                      onClick={() => setSocialsOpen((v) => !v)}
                    >
                      {socials?.enabled && (
                        <ChevronDown className={`${styles.widgetChev}${socialsOpen ? ` ${styles.widgetChevOn}` : ""}`} />
                      )}
                      Social links
                    </button>
                    <label className={`toggle${socials?.enabled ? " on" : ""}`}>
                      <span className="track">
                        <span className="knob" />
                      </span>
                      <input
                        type="checkbox"
                        hidden
                        checked={!!socials?.enabled}
                        onChange={(e) => patchWidget("socials", { enabled: e.target.checked })}
                      />
                      <span className="sr-only">Show social links</span>
                    </label>
                  </div>

                {socials?.enabled && socialsOpen && (
                  <div className={styles.widgetConfig}>
                    {shownSocials.map((s, si) => (
                      <div className="social-row" key={s.id ?? `i${si}`}>
                        <span className="ic" style={{ background: SOCIAL_BRAND[s.kind].bg, color: SOCIAL_BRAND[s.kind].fg }}>
                          <SocialIcon kind={s.kind} />
                        </span>
                        <div className={styles.socialFields}>
                          <select
                            className="chip"
                            style={{ height: 48, padding: "0 12px", borderRadius: "var(--r-2)", background: "var(--bg-0)" }}
                            value={s.kind}
                            onChange={(e) => updateSocial(si, { kind: e.target.value as Social["kind"] })}
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
                              onChange={(e) => updateSocial(si, { url: e.target.value })}
                            />
                            {s.url.trim() && !isSocialValid(s.kind, s.url) && (
                              <div className="footnote" style={{ color: "var(--error)" }}>
                                Not a {SOCIAL_LABEL[s.kind]} link — it won&apos;t show on the page. Try {SOCIAL_EXAMPLE[s.kind]}
                              </div>
                            )}
                          </div>
                        </div>
                        <button className="rm" type="button" aria-label="Remove" onClick={() => removeSocial(si)}>
                          ✕
                        </button>
                      </div>
                    ))}
                    {shownSocials.length < SOCIAL_KINDS.length && (
                      <button className="btn-outline" type="button" style={{ alignSelf: "flex-start" }} onClick={addSocial}>
                        + Add link
                      </button>
                    )}
                  </div>
                )}
                </section>
              </div>
            </div>
          )}

          {/* Nothing on this tab reaches the live page until it's confirmed, so a half-typed
              pitch or a mis-tapped switch is never what a viewer sees. */}
          {tab === "page" && dirty && mounted &&
            createPortal(
              <div className={styles.saveBar}>
                {/* Say why the button is dead — the field is a few centimetres up this same tab. */}
                {pitchMissing && <span className={styles.saveNeeds}>{config.headlineLabel} can&apos;t be empty</span>}
                <button className={styles.discard} type="button" onClick={discardChanges}>
                  Discard
                </button>
                <button className={styles.saveConfirm} type="button" disabled={pitchMissing} onClick={confirmChanges}>
                  Confirm changes ({changeCount})
                </button>
              </div>,
              document.body
            )}

          {/* The rules that cost money live one tab away, not one sidebar item away. */}
          {tab === "rules" && <div className={styles.tabBody}>{rules}</div>}

          {tab === "design" && <DesignTab design={draft.design} onChange={(design) => patchDraft({ design })} />}
        </div>

        <div className={styles.previewCol}>
          <div className={styles.deviceSeg} role="group" aria-label="Preview device">
            <button type="button" className={device === "phone" ? styles.deviceOn : ""} onClick={() => setDevice("phone")}>
              <PhoneIcon /> Phone
            </button>
            <button type="button" className={device === "desktop" ? styles.deviceOn : ""} onClick={() => setDevice("desktop")}>
              <DesktopIcon /> Desktop
            </button>
          </div>
          <LivePreview src={path} device={device} frameRef={frameRef} />

          <div className={styles.linkRow}>
            <div className={styles.linkLabel}>{config.linkLabel}</div>
            <a className={styles.linkChip} href={path} target="_blank" rel="noreferrer">
              <span className="num">{link}</span>
            </a>
            <button type="button" className="btn-outline" onClick={copyLink} aria-label="Copy link">
              <CopyIcon /> {copied ? "Copied!" : "Copy"}
            </button>
            <button type="button" className="btn-outline" onClick={() => setQrOpen((v) => !v)}>
              <QrIcon /> QR code
            </button>
            {qrOpen && (
              <div className={styles.qrPop} role="dialog" aria-label="QR code">
                {qrDataUrl ? (
                  <>
                    <img src={qrDataUrl} alt={`QR code for ${link}`} width={200} height={200} />
                    <a className={styles.qrDownload} href={qrDataUrl} download={config.qrFileName}>
                      Download PNG
                    </a>
                  </>
                ) : (
                  <div className={styles.qrLoading}>Generating…</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}
