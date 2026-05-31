"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Minimum gap (ms) between auto-blinks — the lower bound of the random range. */
const BLINK_INTERVAL_MIN_MS = 6000;
/** Maximum gap (ms) between auto-blinks — the upper bound of the random range. */
const BLINK_INTERVAL_MAX_MS = 10000;
/** ms the closed-eye state stays visible during a blink — a natural human
 *  blink is roughly 100–400 ms, so 200 lands right in the middle. */
const BLINK_DURATION_MS = 200;
/**
 * Per-axis pupil-tracking caps (pixels). Y is intentionally larger than X
 * for a more natural feel — real-character eye movement reads as more
 * expressive when the vertical sweep slightly exceeds the horizontal.
 * Both calibrated so the pupil never leaves the black glasses frame.
 */
const EYE_MAX_RADIUS_X = 20;
const EYE_MAX_RADIUS_Y = 28;
/**
 * Cursor distance (from illustration center) at which the eyes reach their
 * full EYE_MAX_RADIUS_PX displacement. Below this, displacement scales
 * linearly with cursor distance. Smaller value = eyes respond more eagerly
 * to small cursor movements (feels more alive / natural).
 */
const COMFORT_DISTANCE_PX = 220;

/** Random integer in [BLINK_INTERVAL_MIN_MS, BLINK_INTERVAL_MAX_MS]. */
function nextBlinkDelay(): number {
  return (
    BLINK_INTERVAL_MIN_MS +
    Math.random() * (BLINK_INTERVAL_MAX_MS - BLINK_INTERVAL_MIN_MS)
  );
}

/**
 * Parse the `translate(Xpx, Ypx)` CSS string we set from JS. Returns
 * { x: 0, y: 0 } for any string that isn't a recognised translate.
 * We need this to subtract the current displacement from the eye's
 * measured rect so the anchor reflects its *resting* center, not its
 * currently-translated center (which would create a feedback loop).
 */
function parseTranslate(transform: string): { x: number; y: number } {
  if (!transform) return { x: 0, y: 0 };
  const m = transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
  if (!m) return { x: 0, y: 0 };
  return { x: parseFloat(m[1]), y: parseFloat(m[2]) };
}

/**
 * Inline SVG illustration with three interactions:
 *  1. Auto-blink: every BLINK_INTERVAL_MS, swap Open Eye → Close Eye for
 *     BLINK_DURATION_MS, then swap back.
 *  2. Cursor tracking: both eye layers translate together (so the open-eye
 *     and close-eye states never visually drift apart) within an
 *     EYE_MAX_RADIUS_PX radius, scaled by cursor distance from the
 *     illustration's center.
 *  3. Click: trigger an immediate blink and resync the auto-blink timer.
 *
 * The component renders the SVG as `<img>` first (instant paint, CSS-only
 * micro-animations active), then fetches the same URL and swaps to inline
 * SVG once the markup is in hand — at which point all three interactions
 * unlock. The fetch hits browser cache (same URL the img already pulled),
 * so the swap is near-instant on every visit after the first.
 */
export function AuthIllustration({
  src,
  className,
  width,
  height,
}: {
  src: string;
  className?: string;
  width: number;
  height: number;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const openEyeRef = useRef<SVGElement | null>(null);
  const closeEyeRef = useRef<SVGElement | null>(null);
  const blinkTimerRef = useRef<number | null>(null);
  const blinkEndRef = useRef<number | null>(null);

  const [markup, setMarkup] = useState<string | null>(null);

  // Pull the SVG markup so we can inline it (interactivity requires the SVG
  // to share the document DOM — `<img>` isolates it).
  useEffect(() => {
    let cancelled = false;
    fetch(src)
      .then((r) => r.text())
      .then((text) => {
        if (!cancelled) setMarkup(text);
      })
      .catch(() => {
        // Quietly leave the fallback <img> in place if the fetch fails.
      });
    return () => {
      cancelled = true;
    };
  }, [src]);

  // Resolve refs into the freshly-inlined SVG once it's in the DOM.
  // Re-runs if markup changes (shouldn't, but defensive).
  useEffect(() => {
    if (!markup || !wrapperRef.current) return;
    openEyeRef.current = wrapperRef.current.querySelector('[id="Open Eye"]');
    closeEyeRef.current = wrapperRef.current.querySelector('[id="Close Eye"]');
  }, [markup]);

  // One blink: show Close, hide Open, then revert after BLINK_DURATION_MS.
  const blink = useCallback(() => {
    const open = openEyeRef.current;
    const close = closeEyeRef.current;
    if (!open || !close) return;
    open.style.visibility = "hidden";
    close.style.visibility = "visible";
    // Cancel any pending revert so a rapid second blink doesn't double-trigger
    // the same end-of-blink action.
    if (blinkEndRef.current !== null) {
      window.clearTimeout(blinkEndRef.current);
    }
    blinkEndRef.current = window.setTimeout(() => {
      // Refs may have been re-resolved by then — read again.
      const o = openEyeRef.current;
      const c = closeEyeRef.current;
      if (o) o.style.visibility = "visible";
      if (c) c.style.visibility = "hidden";
      blinkEndRef.current = null;
    }, BLINK_DURATION_MS);
  }, []);

  // A ref to the current scheduler so handleClick can re-trigger it without
  // creating a useCallback that needs to reference itself.
  const scheduleRef = useRef<(() => void) | null>(null);

  // Auto-blink loop. Recursively schedules the next blink at a fresh random
  // 6–10 s gap each cycle (so it never feels metronomic). The recursive
  // function lives inside the effect so it can call itself naturally; a ref
  // exposes it to the click handler outside.
  useEffect(() => {
    if (!markup) return;
    function schedule() {
      blinkTimerRef.current = window.setTimeout(() => {
        blink();
        schedule();
      }, nextBlinkDelay());
    }
    scheduleRef.current = schedule;
    schedule();
    return () => {
      scheduleRef.current = null;
      if (blinkTimerRef.current !== null) {
        window.clearTimeout(blinkTimerRef.current);
      }
      if (blinkEndRef.current !== null) {
        window.clearTimeout(blinkEndRef.current);
      }
    };
  }, [markup, blink]);

  // Cursor tracking. Listens on `window` so the eyes follow even when the
  // cursor is outside the illustration column. rAF-throttled so we touch
  // the DOM at most once per frame even on a high-DPI mouse.
  useEffect(() => {
    if (!markup) return;
    let rafId: number | null = null;
    let scheduled = false;
    let latestX = 0;
    let latestY = 0;

    function apply() {
      scheduled = false;
      const open = openEyeRef.current;
      const close = closeEyeRef.current;
      if (!open || !close) return;
      // Anchor at the eye's *resting* center, not the SVG center. The
      // measured rect already includes the previous frame's translate, so
      // subtract that out to avoid a feedback loop where the anchor drifts
      // with the eye's own motion.
      const eyeRect = open.getBoundingClientRect();
      const cur = parseTranslate(open.style.transform);
      const cx = eyeRect.left + eyeRect.width / 2 - cur.x;
      const cy = eyeRect.top + eyeRect.height / 2 - cur.y;
      const dx = latestX - cx;
      const dy = latestY - cy;
      const mag = Math.hypot(dx, dy);
      // Linear scale up to 1 at COMFORT_DISTANCE_PX, capped at 1.
      const ratio = Math.min(1, mag / COMFORT_DISTANCE_PX);
      const ux = mag > 0 ? dx / mag : 0;
      const uy = mag > 0 ? dy / mag : 0;
      const tx = (ux * ratio * EYE_MAX_RADIUS_X).toFixed(2);
      const ty = (uy * ratio * EYE_MAX_RADIUS_Y).toFixed(2);
      const transform = `translate(${tx}px, ${ty}px)`;
      open.style.transform = transform;
      close.style.transform = transform;
    }

    function onMove(e: MouseEvent) {
      latestX = e.clientX;
      latestY = e.clientY;
      if (!scheduled) {
        scheduled = true;
        rafId = window.requestAnimationFrame(apply);
      }
    }

    window.addEventListener("mousemove", onMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMove);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [markup]);

  // Click → manual blink + reset the random schedule so we don't immediately
  // re-blink because the user clicked just before the next scheduled tick.
  const handleClick = useCallback(() => {
    blink();
    if (blinkTimerRef.current !== null) {
      window.clearTimeout(blinkTimerRef.current);
    }
    scheduleRef.current?.();
  }, [blink]);

  return (
    <div
      ref={wrapperRef}
      className={className}
      onClick={handleClick}
      // The wrapper is decorative — the illustration carries no information
      // the user couldn't get from the form. Aria-hidden suppresses both
      // the click target and the SVG content from screen readers.
      aria-hidden="true"
    >
      {markup ? (
        // Inline SVG: interactivity unlocked. React doesn't manage the
        // subtree — refs resolve into it via querySelector in the effect
        // above. The string includes the brand palette and the in-SVG
        // <style id="auth-illustration-anim"> block.
        <span
          dangerouslySetInnerHTML={{ __html: markup }}
          style={{ display: "contents" }}
        />
      ) : (
        // First paint, pre-fetch: render as <img> so CSS-only animations
        // inside the SVG still play. Swapped out once `markup` arrives.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          width={width}
          height={height}
          loading="eager"
          decoding="async"
          draggable={false}
          className="h-auto w-full select-none"
        />
      )}
    </div>
  );
}
