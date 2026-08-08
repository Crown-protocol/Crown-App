"use client";

import { useEffect, useState } from "react";
import { safeId } from "@/lib/id";
import QRCode from "qrcode";
import { QrIcon, CopyIcon, PhoneIcon, DesktopIcon, DragHandleIcon, ChevronDown, SocialIcon, SOCIAL_LABEL, SOCIAL_KINDS, SOCIAL_BRAND } from "@/components/icons";
import { LivePreview } from "@/components/LivePreview";
import { TASK_MAX, WIDGET_LABEL, MAX_DONATE_PRESETS, withPageDefaults } from "@/lib/data/pagebuilder";
import { DesignTab } from "@/components/DesignTab";
import type { PageWidget, Profile, Social } from "@/lib/data/types";
import styles from "./PageBuilder.module.css";

type Tab = "page" | "design";
type Device = "phone" | "desktop";

export function PageBuilder({ profile, onSave }: { profile: Profile; onSave: (p: Profile) => void }) {
  const p = withPageDefaults(profile);
  const [tab, setTab] = useState<Tab>("page");
  const [device, setDevice] = useState<Device>("phone");
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [openWidget, setOpenWidget] = useState<PageWidget["kind"] | null>(null);

  // Real, working URL on whatever host the app runs on (localhost in dev, the real domain in prod) —
  // not a hardcoded "cheer.tv". Resolved after mount to avoid an SSR/client hydration mismatch.
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const link = `${origin || "https://cheer.tv"}/@${p.handle}`;

  useEffect(() => {
    if (!qrOpen) return;
    QRCode.toDataURL(link, { margin: 1, width: 240, color: { dark: "#F1EFF7", light: "#00000000" } })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(""));
  }, [qrOpen, link]);

  function patch(next: Partial<Profile>) {
    onSave({ ...p, ...next });
  }

  function patchWidget(kind: PageWidget["kind"], next: Partial<PageWidget>) {
    patch({ widgets: p.widgets.map((w) => (w.kind === kind ? { ...w, ...next } : w)) });
  }

  function toggleWidgetConfig(kind: PageWidget["kind"]) {
    setOpenWidget((k) => (k === kind ? null : kind));
  }

  function addSocial() {
    patch({ socials: [...p.socials, { kind: "twitch", url: "", id: safeId() }] });
  }

  function updateSocial(i: number, next: Partial<Social>) {
    patch({ socials: p.socials.map((s, j) => (j === i ? { ...s, ...next } : s)) });
  }

  function removeSocial(i: number) {
    patch({ socials: p.socials.filter((_, j) => j !== i) });
  }

  function updatePreset(i: number, value: number) {
    const next = p.donatePresets.slice();
    next[i] = Math.max(1, Math.round(value) || 1);
    patch({ donatePresets: next });
  }

  function addPreset() {
    const last = p.donatePresets[p.donatePresets.length - 1] ?? 5;
    patch({ donatePresets: [...p.donatePresets, last + 5] });
  }

  function removePreset(i: number) {
    if (p.donatePresets.length <= 1) return;
    patch({ donatePresets: p.donatePresets.filter((_, j) => j !== i) });
  }

  function moveWidget(index: number, dir: -1 | 1) {
    const to = index + dir;
    if (to < 0 || to >= p.widgets.length) return;
    const next = p.widgets.slice();
    [next[index], next[to]] = [next[to], next[index]];
    patch({ widgets: next });
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {}
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.builder}>
        <div className={styles.editor}>
          <div className={styles.tabs} role="tablist" aria-label="Page builder">
            <button type="button" role="tab" aria-selected={tab === "page"} className={tab === "page" ? styles.tabOn : ""} onClick={() => setTab("page")}>
              My page
            </button>
            <button type="button" role="tab" aria-selected={tab === "design"} className={tab === "design" ? styles.tabOn : ""} onClick={() => setTab("design")}>
              Design
            </button>
          </div>

          {tab === "page" && (
            <div className={styles.tabBody}>
              <div className="card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div className={styles.rowHead}>Profile</div>
                <div className={styles.avatarRow}>
                  <div className={styles.avatarPreview} style={p.avatarUrl ? { backgroundImage: `url(${p.avatarUrl})` } : undefined}>
                    {!p.avatarUrl && (p.name.trim().charAt(0) || "?")}
                  </div>
                  <div className={styles.avatarControls}>
                    <label className={`toggle${p.avatarEnabled ? " on" : ""}`}>
                      <span className="track"><span className="knob" /></span>
                      <input type="checkbox" hidden checked={p.avatarEnabled} onChange={(e) => patch({ avatarEnabled: e.target.checked })} />
                      Avatar
                    </label>
                    {/* Photo replacement lives in Settings only — the game builder just toggles the
                        avatar on/off for this page. One place to change the picture, no drift. */}
                  </div>
                </div>

                <div className={styles.bioField}>
                  <div className={styles.rowHead}>Task</div>
                  <div className={styles.bioBox}>
                    <textarea
                      className={styles.bioInput}
                      rows={2}
                      maxLength={TASK_MAX}
                      placeholder="What should the viewer do?"
                      value={p.task}
                      onChange={(e) => patch({ task: e.target.value })}
                    />
                    <span className={styles.charCount}>{p.task.length}/{TASK_MAX}</span>
                  </div>
                </div>
              </div>

              <div className={styles.rowHead}>Widgets</div>

              <div className={styles.widgetList}>
                {p.widgets.map((w, i) => {
                  const open = openWidget === w.kind;
                  return (
                    <div key={w.kind} className={styles.widgetGroup}>
                      <div className={`${styles.widgetRow}${w.enabled ? "" : ` ${styles.widgetOff}`}`}>
                        <DragHandleIcon className={styles.dragHandle} />
                        <div className={styles.widgetStepper}>
                          <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => moveWidget(i, -1)}>▲</button>
                          <button type="button" aria-label="Move down" disabled={i === p.widgets.length - 1} onClick={() => moveWidget(i, 1)}>▼</button>
                        </div>
                        <button type="button" className={styles.widgetNameBtn} aria-expanded={open} onClick={() => toggleWidgetConfig(w.kind)}>
                          {WIDGET_LABEL[w.kind]}
                          <ChevronDown className={`${styles.widgetChev}${open ? ` ${styles.widgetChevOn}` : ""}`} />
                        </button>
                        <label className={`toggle${w.enabled ? " on" : ""}`}>
                          <span className="track"><span className="knob" /></span>
                          <input type="checkbox" hidden checked={w.enabled} onChange={(e) => patchWidget(w.kind, { enabled: e.target.checked })} />
                        </label>
                      </div>

                      {open && w.kind === "donate" && (
                        <div className={styles.widgetConfig}>
                          <div className={styles.presetRow}>
                            {p.donatePresets.map((amount, pi) => (
                              <div className={styles.presetChip} key={pi}>
                                <span className={styles.presetDollar}>$</span>
                                <input
                                  type="number"
                                  min={1}
                                  aria-label={`Amount ${pi + 1}`}
                                  value={amount}
                                  onChange={(e) => updatePreset(pi, +e.target.value)}
                                />
                                {p.donatePresets.length > 1 && (
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
                            ))}
                            {p.donatePresets.length < MAX_DONATE_PRESETS && (
                              <button type="button" className={styles.presetAdd} aria-label="Add amount" onClick={addPreset}>
                                +
                              </button>
                            )}
                          </div>
                        </div>
                      )}

                      {open && w.kind === "socials" && (
                        <div className={styles.widgetConfig}>
                          {p.socials.map((s, si) => (
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
                                    placeholder={`${s.kind}.com/…`}
                                    value={s.url}
                                    onChange={(e) => updateSocial(si, { url: e.target.value })}
                                  />
                                </div>
                              </div>
                              <button className="rm" type="button" aria-label="Remove" onClick={() => removeSocial(si)}>
                                ✕
                              </button>
                            </div>
                          ))}
                          {p.socials.length < SOCIAL_KINDS.length && (
                            <button className="btn-outline" type="button" style={{ alignSelf: "flex-start" }} onClick={addSocial}>
                              + Add link
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {tab === "design" && <DesignTab design={p.design} onChange={(design) => patch({ design })} />}
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
          <LivePreview src={`/@${p.handle}`} device={device} />

          <div className={styles.linkRow}>
            <div className={styles.linkLabel}>Your link</div>
            <a className={styles.linkChip} href={`/@${p.handle}`} target="_blank" rel="noreferrer">
              <span className="num">{link}</span>
            </a>
            {/* href stays a relative /@handle so it works regardless of host; the text shows the full URL */}
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
                    <a className={styles.qrDownload} href={qrDataUrl} download="cheer-qr.png">
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
