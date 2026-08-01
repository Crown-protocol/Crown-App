"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./CropModal.module.css";

// Full-screen photo cropper (ported from bobounty, extended): drag to reposition, wheel or the +/-
// buttons to zoom toward the cursor, re-upload, and a pick-the-shape mask. Confirm renders the crop
// to 256×256 clipped to the chosen shape and returns a data URL — a circle/rounded is a PNG so its
// corners are transparent (the mask you SEE is the image you GET), a square is a compact JPEG.
const VP = 300; // on-screen viewport size
const CROP_OUTPUT = 256; // exported square size
const MAX_BYTES = 150_000; // JPEG byte budget (square only)
const ROUND_R = 0.18; // rounded-corner radius as a fraction of the side

type Shape = "circle" | "rounded" | "square" | "hexagon";

// A pointy-top regular hexagon inscribed in an n×n box — the same orientation as the Crown badge.
function hexPoints(n: number): [number, number][] {
  const c = n / 2;
  return Array.from({ length: 6 }, (_, i) => {
    const a = ((-90 + 60 * i) * Math.PI) / 180;
    return [c + c * Math.cos(a), c + c * Math.sin(a)] as [number, number];
  });
}

// Trace the chosen shape onto a 2D context, at side `n`, ready to fill/clip.
function traceShape(ctx: CanvasRenderingContext2D, n: number, shape: Shape) {
  ctx.beginPath();
  if (shape === "circle") {
    ctx.arc(n / 2, n / 2, n / 2, 0, Math.PI * 2);
  } else if (shape === "hexagon") {
    const pts = hexPoints(n);
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  } else if (shape === "rounded") {
    const r = n * ROUND_R;
    if (ctx.roundRect) ctx.roundRect(0, 0, n, n, r);
    else {
      ctx.moveTo(r, 0);
      ctx.arcTo(n, 0, n, n, r);
      ctx.arcTo(n, n, 0, n, r);
      ctx.arcTo(0, n, 0, 0, r);
      ctx.arcTo(0, 0, n, 0, r);
    }
  } else {
    ctx.rect(0, 0, n, n);
  }
  ctx.closePath();
}

// The mask/outline shape, drawn to fill the whole viewport so the bright area maps 1:1 to the output.
function ShapeSvg({ shape, fill, stroke, strokeWidth }: { shape: Shape; fill: string; stroke?: string; strokeWidth?: number }) {
  const common = { fill, stroke, strokeWidth };
  if (shape === "circle") return <circle cx={VP / 2} cy={VP / 2} r={VP / 2} {...common} />;
  if (shape === "hexagon") return <polygon points={hexPoints(VP).map(([x, y]) => `${x},${y}`).join(" ")} {...common} />;
  return <rect x={0} y={0} width={VP} height={VP} rx={shape === "rounded" ? VP * ROUND_R : 0} {...common} />;
}

export function CropModal({
  imageSrc,
  onConfirm,
  onCancel,
  onReupload,
  shape: initialShape = "circle",
}: {
  imageSrc: string;
  onConfirm: (dataUrl: string) => void;
  onCancel: () => void;
  onReupload?: (file: File) => void;
  shape?: Shape;
}) {
  // Avatars are always a circle — the shape picker was removed, so `shape` is fixed to whatever the
  // caller asks for (circle by default). The mask/clip code below still branches on it generically.
  const shape = initialShape;
  const viewportRef = useRef<HTMLDivElement>(null);
  // x/y (viewport px) and scale live in ONE object updated by a pure function. They used to be three
  // separate states with setCropX/setCropY nested inside setCropScale's updater — but React calls
  // updaters twice in dev (StrictMode) to catch impurity, so the nested pan ran twice and the zoom
  // over-shot the cursor. A single pure updater is idempotent under the double call.
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const [baseScale, setBaseScale] = useState(1);
  const [nat, setNat] = useState({ w: 0, h: 0 });
  const [ready, setReady] = useState(false);
  const drag = useRef<{ on: boolean; x: number; y: number; cx: number; cy: number }>({ on: false, x: 0, y: 0, cx: 0, cy: 0 });

  // Load the image and frame it: scale so the shorter side fills the viewport, then centre it.
  useEffect(() => {
    setReady(false);
    const img = new Image();
    img.onload = () => {
      const bs = VP / Math.min(img.width, img.height);
      setNat({ w: img.width, h: img.height });
      setBaseScale(bs);
      setView({ x: (VP - img.width * bs) / 2, y: (VP - img.height * bs) / 2, scale: 1 });
      setReady(true);
    };
    // A source that can't decode must not leave the modal stuck blank forever — close it.
    img.onerror = () => onCancel();
    img.src = imageSrc;
    // Re-run only when the image changes; onCancel is defined inline by parents (not stable) and
    // must not retrigger the load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageSrc]);

  // Zoom one step, keeping the focal point (fx,fy in viewport px) pinned under the cursor — so
  // whatever is under the mouse stays there as it scales. The +/- buttons pass the centre.
  const zoomAt = useCallback((dir: 1 | -1, fx: number, fy: number) => {
    setView((v) => {
      const factor = dir > 0 ? 1.1 : 0.9;
      const ns = Math.max(0.3, Math.min(5, v.scale * factor));
      const k = ns / v.scale;
      return { x: fx - (fx - v.x) * k, y: fy - (fy - v.y) * k, scale: ns };
    });
  }, []);

  // Wheel = zoom toward the cursor. Bound natively because React's onWheel is passive on some paths
  // (preventDefault would be ignored). Crucially depends on `ready`: the modal returns null until the
  // image loads, so on the first run viewportRef is still null and the listener never attaches — this
  // re-runs the moment the viewport actually mounts. (That was the "wheel doesn't work" bug.)
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAt(e.deltaY > 0 ? -1 : 1, e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt, ready]);

  function onPointerDown(e: React.PointerEvent) {
    drag.current = { on: true, x: e.clientX, y: e.clientY, cx: view.x, cy: view.y };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current.on) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    setView((v) => ({ ...v, x: drag.current.cx + dx, y: drag.current.cy + dy }));
  }
  function onPointerUp() {
    drag.current.on = false;
  }

  async function confirm() {
    const out = document.createElement("canvas");
    out.width = CROP_OUTPUT;
    out.height = CROP_OUTPUT;
    const ctx = out.getContext("2d");
    if (!ctx) return;
    const ratio = CROP_OUTPUT / VP;
    const s = baseScale * view.scale * ratio;

    const img = new Image();
    img.src = imageSrc;
    await new Promise<void>((resolve) => {
      if (img.complete && img.naturalWidth > 0) return resolve();
      img.onload = () => resolve();
    });
    ctx.drawImage(img, view.x * ratio, view.y * ratio, img.width * s, img.height * s);

    // Keep only the pixels inside the chosen shape; the rest becomes transparent.
    if (shape !== "square") {
      ctx.globalCompositeOperation = "destination-in";
      ctx.fillStyle = "#fff";
      traceShape(ctx, CROP_OUTPUT, shape);
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";
    }

    let blob: Blob | null;
    if (shape === "square") {
      // Opaque, so JPEG — step quality down until it fits the byte budget.
      let quality = 0.85;
      do {
        blob = await new Promise<Blob | null>((r) => out.toBlob(r, "image/jpeg", quality));
        quality -= 0.1;
      } while (blob && blob.size > MAX_BYTES && quality > 0.1);
      if (!blob || blob.size > MAX_BYTES) {
        alert("Image too large even after compression.");
        return;
      }
    } else {
      // Transparent corners need PNG. A 256px avatar with transparent corners stays small.
      blob = await new Promise<Blob | null>((r) => out.toBlob(r, "image/png"));
      if (!blob) return;
    }

    const reader = new FileReader();
    reader.onload = () => onConfirm(reader.result as string);
    reader.onerror = () => onCancel();
    reader.readAsDataURL(blob);
  }

  const imgStyle = useMemo(
    () => ({
      transform: `translate(${view.x}px, ${view.y}px) scale(${baseScale * view.scale})`,
      transformOrigin: "0 0" as const,
      width: nat.w,
      height: nat.h,
    }),
    [view, baseScale, nat]
  );

  if (!ready || typeof document === "undefined") return null;

  // Portal to <body>: the overlay is position:fixed, but a fixed element is trapped by any ancestor
  // with a transform/filter/overflow (e.g. the cabinet's animated .main and the builder columns) —
  // rendered in place it landed inside a panel and got clipped. From <body> it always covers the
  // whole screen, above everything. (In /create the layout is plain, so it worked either way.)
  return createPortal(
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Crop your photo">
      <div className={styles.header}>
        <button className={styles.close} type="button" onClick={onCancel} aria-label="Cancel">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
        <span className={styles.title}>Drag to reposition</span>
        {onReupload ? (
          <label className={styles.reupload}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M1 4v6h6" />
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
            Re-upload
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onReupload(f);
                e.target.value = "";
              }}
            />
          </label>
        ) : (
          <span />
        )}
      </div>

      <div
        className={styles.viewport}
        ref={viewportRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <img src={imageSrc} alt="" className={styles.img} style={imgStyle} draggable={false} />
        <svg className={styles.mask} viewBox={`0 0 ${VP} ${VP}`}>
          <defs>
            <mask id="crown-cmask">
              <rect width={VP} height={VP} fill="white" />
              <ShapeSvg shape={shape} fill="black" />
            </mask>
          </defs>
          <rect width={VP} height={VP} fill="rgba(0,0,0,0.55)" mask="url(#crown-cmask)" />
          <ShapeSvg shape={shape} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={1.5} />
        </svg>
      </div>

      <div className={styles.zoom}>
        <button className={styles.zoomBtn} type="button" onClick={() => zoomAt(1, VP / 2, VP / 2)} aria-label="Zoom in">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
        <button className={styles.zoomBtn} type="button" onClick={() => zoomAt(-1, VP / 2, VP / 2)} aria-label="Zoom out">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>

      <button className={styles.confirm} type="button" onClick={confirm} aria-label="Use this photo">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </button>
    </div>,
    document.body
  );
}
