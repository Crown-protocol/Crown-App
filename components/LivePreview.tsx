"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./LivePreview.module.css";

// A phone/desktop device frame with the REAL public page rendered inside, via an iframe.
// This is the whole point: the preview isn't a hand-kept mirror that drifts from the page —
// it IS the page, at the same URL a viewer opens, so it can never be out of sync. Edits in the
// builder are saved to localStorage; the iframe's ProfileProvider hears the `storage` event and
// re-renders, so the preview updates live as you type.
//
// The page is authored at a real device width (390 phone / 1280 desktop) and scaled down to the
// frame with a CSS transform. The iframe is rendered at its FULL content height and the frame is a
// scroll container, so hovering the preview and using the mouse wheel pages through the whole page —
// no content is ever cut off at the bottom.
const LOGICAL_WIDTH = { phone: 390, desktop: 1280 } as const;

export function LivePreview({
  src,
  device,
  frameRef,
}: {
  src: string;
  device: "phone" | "desktop";
  // Lets the builder reach the iframe to post its unconfirmed edits in (previewOverlay.ts).
  frameRef?: React.MutableRefObject<HTMLIFrameElement | null>;
}) {
  const isDesktop = device === "desktop";
  const screenRef = useRef<HTMLDivElement>(null);
  // Nullable so the callback ref below can assign it — `useRef<T>(null)` is a read-only RefObject.
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [contentH, setContentH] = useState(0);
  const [loaded, setLoaded] = useState(false);

  // A new src (device switch, or a fresh page) is loading again — hide it behind the loader until
  // the iframe reports ready, so the frame never flashes a dark blank screen.
  useEffect(() => {
    setLoaded(false);
  }, [src]);

  useEffect(() => {
    const el = screenRef.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [device]);

  // Full scroll height of the real page inside the iframe (same-origin, so readable). Kept fresh
  // via a ResizeObserver on the iframe's document, so the scrollable area tracks live edits.
  const measureContent = useCallback(() => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    const h = Math.max(doc.documentElement?.scrollHeight || 0, doc.body?.scrollHeight || 0);
    if (h) setContentH(h);
  }, []);

  const onLoad = useCallback(() => {
    setLoaded(true);
    roRef.current?.disconnect();
    measureContent();
    const doc = iframeRef.current?.contentDocument;
    if (doc && typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => measureContent());
      ro.observe(doc.documentElement);
      if (doc.body) ro.observe(doc.body);
      roRef.current = ro;
    }
  }, [measureContent]);

  useEffect(() => () => roRef.current?.disconnect(), []);

  const logicalW = LOGICAL_WIDTH[device];
  // Never shrink the desktop page past readability. Below this the frame shows the left part of a
  // 1280px page and the rest scrolls sideways — a legible slice beats an illegible whole.
  const MIN_SCALE = device === "desktop" ? 0.52 : 0.3;
  const fitScale = box.w ? box.w / logicalW : 0;
  const scale = fitScale ? Math.max(fitScale, MIN_SCALE) : 0;
  // Full content height once measured, but never SHORTER than the frame: a page whose content ends
  // early would otherwise leave a strip of the frame's own dark background under it — a bar that
  // doesn't exist on the real page. At frame height the page's min-height:100vh paints it instead.
  const iframeH = Math.max(contentH, scale ? box.h / scale : 0);
  const scaledH = iframeH * scale;

  const frame = (
    <div className={`${styles.frame} ${isDesktop ? styles.desktop : styles.phone}`}>
      {isDesktop ? (
        <div className={styles.browserBar}>
          <span className={styles.dot} />
          <span className={styles.dot} />
          <span className={styles.dot} />
          <span className={styles.url}>{src}</span>
        </div>
      ) : (
        // The phone's chrome, sized like the desktop's browser bar above: a real row, so the notch
        // reads as a phone without ever sitting on top of the page.
        <div className={styles.bezel} aria-hidden>
          <span className={styles.notch} />
        </div>
      )}
      <div className={styles.screen} ref={screenRef}>
        {scale > 0 && (
          <div className={styles.scaler} style={{ height: scaledH, width: logicalW * scale }}>
            <iframe
              ref={(el) => {
                iframeRef.current = el;
                if (frameRef) frameRef.current = el;
              }}
              onLoad={onLoad}
              title="Live page preview"
              src={src}
              className={`${styles.iframe} ${loaded ? styles.iframeReady : ""}`}
              style={{ width: logicalW, height: iframeH, transform: `scale(${scale})` }}
              scrolling="no"
              tabIndex={-1}
              aria-hidden
            />
          </div>
        )}
        {!loaded && (
          <div className={styles.loader} aria-hidden>
            <span className={styles.spinner} />
          </div>
        )}
      </div>
    </div>
  );

  if (isDesktop) return frame;

  // Purely decorative physical side buttons on the phone — mute + volume on the left, the side/power
  // button on the right. Rendered on a non-clipping wrapper so they can protrude past the bezel; the
  // frame itself keeps overflow:hidden for its rounded corners. Cabinet-only, since LivePreview is.
  return (
    <div className={styles.phoneWrap}>
      <span className={`${styles.sideBtn} ${styles.mute}`} aria-hidden />
      <span className={`${styles.sideBtn} ${styles.volume}`} aria-hidden />
      <span className={`${styles.sideBtn} ${styles.power}`} aria-hidden />
      {frame}
    </div>
  );
}
