"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Shared open/close motion language (gallery Show more/less gold standard). */
export const REVEAL_EASE =
  "ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none";

export const EXPAND_DURATION_MS = 500;

export const OVERLAY_DURATION_MS = 200;

export const OVERLAY_EASE =
  "duration-200 ease-out motion-reduce:transition-none";

export function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function ExpandChevron({ open, className = "h-4 w-4" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 transition-transform duration-300 ${REVEAL_EASE} ${
        open ? "rotate-180" : ""
      } ${className}`}
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/**
 * Height accordion panel. Content stays opaque while closing so overflow
 * clips it instead of fading images out before the collapse.
 * Children stay mounted through the close animation.
 */
export function ExpandPanel({
  open,
  children,
  className = "",
  innerClassName = "",
  durationMs = EXPAND_DURATION_MS,
}) {
  const [rendered, setRendered] = useState(open);

  // Open immediately (render-time adjust). Close after the height transition.
  if (open && !rendered) {
    setRendered(true);
  }

  useEffect(() => {
    if (open) return undefined;
    const delay = prefersReducedMotion() ? 0 : durationMs;
    const timer = window.setTimeout(() => setRendered(false), delay);
    return () => window.clearTimeout(timer);
  }, [open, durationMs]);

  return (
    <div
      className={`grid transition-[grid-template-rows] ${REVEAL_EASE} ${
        open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
      } ${className}`}
      style={{ transitionDuration: `${durationMs}ms` }}
    >
      <div className="overflow-hidden" inert={!open || undefined}>
        <div className={innerClassName}>{rendered ? children : null}</div>
      </div>
    </div>
  );
}

/**
 * Staggered enter for expand-panel children. On close, stay fully visible so
 * the parent height clip hides content — never fade images out first.
 */
export function ExpandStaggerItem({ open, index = 0, children, className = "" }) {
  const [entered, setEntered] = useState(false);

  if (!open && entered) {
    setEntered(false);
  }

  useEffect(() => {
    if (!open) return undefined;
    if (prefersReducedMotion()) {
      const id = window.requestAnimationFrame(() => setEntered(true));
      return () => window.cancelAnimationFrame(id);
    }
    let innerId = 0;
    const outerId = window.requestAnimationFrame(() => {
      innerId = window.requestAnimationFrame(() => setEntered(true));
    });
    return () => {
      window.cancelAnimationFrame(outerId);
      window.cancelAnimationFrame(innerId);
    };
  }, [open]);

  // Closing (!open) while still mounted: keep opaque for height clipping.
  // Opening: start hidden, then stagger in once `entered` flips.
  const visible = !open || entered;

  return (
    <div
      className={`transition motion-reduce:transform-none ${REVEAL_EASE} ${
        visible ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
      } ${className}`}
      style={{
        transitionDuration: `${EXPAND_DURATION_MS}ms`,
        transitionDelay:
          visible && open ? `${90 + index * 70}ms` : "0ms",
      }}
    >
      {children}
    </div>
  );
}

/**
 * Keep an overlay mounted through its exit fade. `visible` drives opacity;
 * unmount after `durationMs` when `open` becomes false.
 */
export function useOverlayPresence(open, durationMs = OVERLAY_DURATION_MS) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);

  if (open && !mounted) {
    setMounted(true);
  }

  useEffect(() => {
    if (open) {
      let innerId = 0;
      const outerId = window.requestAnimationFrame(() => {
        if (prefersReducedMotion()) {
          setVisible(true);
          return;
        }
        innerId = window.requestAnimationFrame(() => setVisible(true));
      });
      return () => {
        window.cancelAnimationFrame(outerId);
        window.cancelAnimationFrame(innerId);
      };
    }

    const hideId = window.requestAnimationFrame(() => setVisible(false));
    const delay = prefersReducedMotion() ? 0 : durationMs;
    const timer = window.setTimeout(() => setMounted(false), delay);
    return () => {
      window.cancelAnimationFrame(hideId);
      window.clearTimeout(timer);
    };
  }, [open, durationMs]);

  return { mounted, visible };
}

/**
 * Mount-time enter fade + delayed close for overlays that unmount when the
 * parent clears them (lightbox / quote-login). Opacity only — no transform.
 */
export function useOverlayEnterExit(durationMs = OVERLAY_DURATION_MS) {
  const [visible, setVisible] = useState(false);
  const closingRef = useRef(false);

  useEffect(() => {
    let innerId = 0;
    const outerId = window.requestAnimationFrame(() => {
      if (prefersReducedMotion()) {
        setVisible(true);
        return;
      }
      innerId = window.requestAnimationFrame(() => setVisible(true));
    });
    return () => {
      window.cancelAnimationFrame(outerId);
      window.cancelAnimationFrame(innerId);
    };
  }, []);

  const fadeThen = useCallback(
    (action) => {
      if (closingRef.current) return;
      closingRef.current = true;
      setVisible(false);
      const delay = prefersReducedMotion() ? 0 : durationMs;
      window.setTimeout(() => action(), delay);
    },
    [durationMs],
  );

  return { visible, fadeThen };
}

/** Opacity classes for overlay shells (no transform — keeps `fixed` correct). */
export function overlayFadeClassName(visible) {
  return `transition-opacity ${OVERLAY_EASE} ${
    visible ? "opacity-100" : "opacity-0"
  }`;
}
