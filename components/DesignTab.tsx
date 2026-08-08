"use client";

import { useEffect, useRef, useState } from "react";
import type { PageDesign, PageBackground } from "@/lib/data/types";
import {
  BACKGROUND_COLOR_PRESETS,
  BACKGROUND_GRADIENT_PRESETS,
  BACKGROUND_IMAGE_PRESETS,
  DEFAULT_GRADIENT_VALUE,
  GRAD_DEFAULTS,
  gradientCss,
  gradientStops,
} from "@/lib/data/pagebuilder";
import { readBgLibrary, addBgPhoto, removeBgPhoto, type BgPhoto } from "@/lib/data/bgLibrary";
import { UploadIcon } from "@/components/icons";
import styles from "./PageBuilder.module.css";

// The Design tab, shared by every page builder (the main page + all four mini-games) so they can't
// drift apart. The Color/Gradient/Image toggle picks WHAT the gallery below shows; every mode
// presents its presets the same way — one big labelled tile each. For a photo the streamer also
// picks how it sits, since a portrait photo can't fill both a phone and a desktop cleanly:
//   Fill screen — cover, pinned to the viewport
//   Whole photo — fit to width at the top, page colour below
//   Phone + desktop — two photos, one per device
// Backdrop only: the accent stays Cheer purple everywhere (design charter II.1).

type BgType = "color" | "gradient" | "image";
type Fit = "cover" | "width" | "split";
const HEX6 = /^#[0-9a-fA-F]{6}$/;
const FITS: [Fit, string][] = [
  ["cover", "Fill screen"],
  ["width", "Whole photo"],
  ["split", "Phone + desktop"],
];

// Shrink an uploaded photo before it's stored as a data URL — keeps the library (and the profile it
// gets saved into) well under the localStorage budget. Falls back to the raw file on any hiccup.
function downscale(file: File, max = 1600, quality = 0.85): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        if (scale >= 1) return resolve(raw);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(raw);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => resolve(raw);
      img.src = raw;
    };
    reader.onerror = () => resolve("");
    reader.readAsDataURL(file);
  });
}

// The photo gallery — built-in backdrops, the streamer's uploaded library, and an upload tile.
// Reused for the single photo and, in split mode, once per device.
function ImageGallery({
  selected,
  onSelect,
  library,
  onAddPhoto,
  onRemovePhoto,
  wide = false,
}: {
  selected: string;
  // A built-in preset carries BOTH device photos — urlWide rides along so one click sets the pair.
  onSelect: (url: string, urlWide?: string) => void;
  library: BgPhoto[];
  onAddPhoto: (url: string) => void;
  onRemovePhoto: (id: string, url: string) => void;
  // The desktop half of split mode: a preset stands for its wide photo, not its tall one.
  wide?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const url = await downscale(file);
    if (!url) return;
    onAddPhoto(url);
    onSelect(url);
  }
  return (
    <div className={styles.tileGrid}>
      {BACKGROUND_IMAGE_PRESETS.map((img) => {
        // Each gallery previews — and selects — the photo for ITS device, so the tile the streamer
        // clicked is the tile that lights up. Only the phone side carries the pair along.
        const url = (wide ? img.urlWide : img.url) ?? img.url;
        return (
          <button
            key={img.id}
            type="button"
            aria-label={img.label}
            className={`${styles.tile} ${selected === url ? styles.tileOn : ""}`}
            style={{ backgroundImage: `url(${url})` }}
            onClick={() => onSelect(url, wide ? undefined : img.urlWide)}
          >
            <span className={styles.tileLabel}>{img.label}</span>
          </button>
        );
      })}
      {library.map((p, i) => (
        <button
          key={p.id}
          type="button"
          aria-label={`Your photo ${i + 1}`}
          className={`${styles.tile} ${selected === p.url ? styles.tileOn : ""}`}
          style={{ backgroundImage: `url(${p.url})` }}
          onClick={() => onSelect(p.url)}
        >
          <span
            className={styles.tileRemove}
            role="button"
            aria-label="Remove photo"
            onClick={(e) => {
              e.stopPropagation();
              onRemovePhoto(p.id, p.url);
            }}
          >
            ✕
          </span>
        </button>
      ))}
      <button type="button" className={`${styles.tile} ${styles.tileUpload}`} onClick={() => fileRef.current?.click()}>
        <UploadIcon /> Your photo
      </button>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
    </div>
  );
}

export function DesignTab({ design, onChange }: { design: PageDesign; onChange: (design: PageDesign) => void }) {
  const [library, setLibrary] = useState<BgPhoto[]>([]);
  useEffect(() => setLibrary(readBgLibrary()), []);

  const bg = design.background;
  const { type, value } = bg;
  const fit: Fit = bg.fit ?? "cover";
  const set = (background: PageBackground) => onChange({ background });
  // Patch an image background while preserving its other fields (fit, the two photos).
  const setImg = (patch: Partial<PageBackground>) =>
    set({ type: "image", value: bg.value, fit: bg.fit ?? "cover", valueWide: bg.valueWide, ...patch });

  function pickType(t: BgType) {
    if (t === type) return;
    if (t === "color") set({ type: "color", value: BACKGROUND_COLOR_PRESETS[0].hex });
    else if (t === "gradient") set({ type: "gradient", value: DEFAULT_GRADIENT_VALUE });
    else set({ type: "image", value: BACKGROUND_IMAGE_PRESETS[0]?.url ?? "", fit: "cover" });
  }

  function setFit(f: Fit) {
    // entering split with no desktop photo yet: start it from the phone photo, so nothing is blank —
    // its paired wide shot when the phone one is a built-in preset, else the same image
    const pair = BACKGROUND_IMAGE_PRESETS.find((p) => p.url === bg.value);
    setImg({ fit: f, ...(f === "split" && !bg.valueWide ? { valueWide: pair?.urlWide ?? bg.value } : {}) });
  }

  function addPhoto(url: string) {
    setLibrary(addBgPhoto(url));
  }
  function removePhoto(id: string, url: string) {
    setLibrary(removeBgPhoto(id));
    const fallback = BACKGROUND_IMAGE_PRESETS[0]?.url ?? "";
    const fallbackWide = BACKGROUND_IMAGE_PRESETS[0]?.urlWide ?? fallback;
    // a removed photo can't stay selected on either device
    if (bg.value === url || bg.valueWide === url) {
      setImg({
        ...(bg.value === url ? { value: fallback } : {}),
        ...(bg.valueWide === url ? { valueWide: fallbackWide } : {}),
      });
    }
  }

  const stops = type === "gradient" ? gradientStops(value) : null;
  const gAngle = bg.gradAngle ?? GRAD_DEFAULTS.angle;
  const gPos = bg.gradPos ?? GRAD_DEFAULTS.pos;
  const gSoft = bg.gradSoft ?? GRAD_DEFAULTS.soft;
  // Patch a gradient background, preserving its colours + the layout knobs not being changed.
  const setGrad = (patch: Partial<PageBackground>) =>
    set({ type: "gradient", value: bg.value, gradAngle: bg.gradAngle, gradPos: bg.gradPos, gradSoft: bg.gradSoft, ...patch });

  return (
    <div className={styles.tabBody}>
      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div className={styles.rowHead}>Page background</div>

        <div className={styles.bgTypeRow}>
          {(["color", "gradient", "image"] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={`${styles.bgType} ${type === t ? styles.bgTypeOn : ""}`}
              onClick={() => pickType(t)}
            >
              {t === "color" ? "Color" : t === "gradient" ? "Gradient" : "Image"}
            </button>
          ))}
        </div>

        {type === "color" && (
          <>
            <div className={styles.tileGrid}>
              {BACKGROUND_COLOR_PRESETS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-label={c.label}
                  className={`${styles.tile} ${value === c.hex ? styles.tileOn : ""}`}
                  style={{ background: c.hex }}
                  onClick={() => set({ type: "color", value: c.hex })}
                >
                  <span className={styles.tileLabel}>{c.label}</span>
                </button>
              ))}
            </div>
            <div className={styles.pickRow}>
              <input
                type="color"
                className={styles.colorPick}
                aria-label="Custom background color"
                value={HEX6.test(value) ? value : "#141318"}
                onChange={(e) => set({ type: "color", value: e.target.value })}
              />
              <input className={styles.hexInput} type="text" value={value} onChange={(e) => set({ type: "color", value: e.target.value })} />
            </div>
          </>
        )}

        {type === "gradient" && stops && (
          <>
            <div className={styles.tileGrid}>
              {BACKGROUND_GRADIENT_PRESETS.map((g) => {
                const v = `${g.from}|${g.to}`;
                return (
                  <button
                    key={g.id}
                    type="button"
                    aria-label={g.label}
                    className={`${styles.tile} ${value === v ? styles.tileOn : ""}`}
                    style={{ backgroundImage: gradientCss(g.from, g.to, g.angle, g.pos, g.soft) }}
                    onClick={() =>
                      setGrad({
                        value: v,
                        gradAngle: g.angle ?? GRAD_DEFAULTS.angle,
                        gradPos: g.pos ?? GRAD_DEFAULTS.pos,
                        gradSoft: g.soft ?? GRAD_DEFAULTS.soft,
                      })
                    }
                  >
                    <span className={styles.tileLabel}>{g.label}</span>
                  </button>
                );
              })}
            </div>
            <div className={styles.gradientStops}>
              <label className={styles.stopField}>
                <input
                  type="color"
                  className={styles.colorPick}
                  aria-label="Gradient start color"
                  value={stops.from}
                  onChange={(e) => setGrad({ value: `${e.target.value}|${stops.to}` })}
                />
                <span>From</span>
              </label>
              <span className={styles.gradientBar} style={{ backgroundImage: gradientCss(stops.from, stops.to, gAngle, gPos, gSoft) }} aria-hidden />
              <label className={styles.stopField}>
                <input
                  type="color"
                  className={styles.colorPick}
                  aria-label="Gradient end color"
                  value={stops.to}
                  onChange={(e) => setGrad({ value: `${stops.from}|${e.target.value}` })}
                />
                <span>To</span>
              </label>
            </div>
            <div className={styles.sliders}>
              <label className={styles.slider}>
                <span>
                  Angle <em>{gAngle}°</em>
                </span>
                <input type="range" min={0} max={360} step={5} value={gAngle} onChange={(e) => setGrad({ gradAngle: Number(e.target.value) })} />
              </label>
              <label className={styles.slider}>
                <span>
                  Center <em>{gPos}%</em>
                </span>
                <input type="range" min={0} max={100} value={gPos} onChange={(e) => setGrad({ gradPos: Number(e.target.value) })} />
              </label>
              <label className={styles.slider}>
                <span>
                  Blend <em>{gSoft === 0 ? "hard edge" : `${gSoft}%`}</em>
                </span>
                <input type="range" min={0} max={100} value={gSoft} onChange={(e) => setGrad({ gradSoft: Number(e.target.value) })} />
              </label>
            </div>
          </>
        )}

        {type === "image" && (
          <>
            <div className={styles.bgTypeRow}>
              {FITS.map(([f, label]) => (
                <button key={f} type="button" className={`${styles.bgType} ${fit === f ? styles.bgTypeOn : ""}`} onClick={() => setFit(f)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="footnote">
              {fit === "cover"
                ? "Fills the screen and stays put — on a wide desktop you'll see a vertical slice of a tall photo."
                : fit === "width"
                ? "The whole photo at the top, never cropped or blown up; your background colour fills around it."
                : "Two photos — the first shows on phones, the second on desktops."}
            </div>

            {fit === "split" && <div className={styles.subHead}>Phone photo</div>}
            <ImageGallery
              selected={value}
              // A paired preset switches to split and fills both devices in one click; a single
              // photo (upload/legacy) just becomes the one image, as before.
              onSelect={(url, urlWide) => setImg(urlWide ? { value: url, valueWide: urlWide, fit: "split" } : { value: url })}
              library={library}
              onAddPhoto={addPhoto}
              onRemovePhoto={removePhoto}
            />

            {fit === "split" && (
              <>
                <div className={styles.subHead}>Desktop photo</div>
                <ImageGallery
                  wide
                  selected={bg.valueWide ?? ""}
                  onSelect={(url) => setImg({ valueWide: url })}
                  library={library}
                  onAddPhoto={addPhoto}
                  onRemovePhoto={removePhoto}
                />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
