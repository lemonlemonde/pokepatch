"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import {
  overlayFadeClassName,
  useOverlayPresence,
} from "@/components/ExpandReveal";

const DEFAULT_TITLE = "Unsaved changes";
const DEFAULT_BODY =
  "You have unsaved changes. If you leave now, those edits will be lost.";

export default function UnsavedChangesDialog({
  open,
  title = DEFAULT_TITLE,
  body = DEFAULT_BODY,
  stayLabel = "Keep editing",
  leaveLabel = "Leave without saving",
  onStay,
  onLeave,
}) {
  const { mounted, visible } = useOverlayPresence(open);

  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(event) {
      if (event.key === "Escape") onStay();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onStay]);

  if (!mounted) return null;

  const dialog = (
    <div
      className={`fixed inset-0 z-[300] flex items-center justify-center bg-night/70 px-4 py-6 ${overlayFadeClassName(visible)}`}
      role="presentation"
      onClick={onStay}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="unsaved-changes-title"
        aria-describedby="unsaved-changes-body"
        className="w-full max-w-md overflow-hidden rounded-2xl border border-ink/15 bg-cream "
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-ink/10 px-5 py-4">
          <h2
            id="unsaved-changes-title"
            className="text-xl font-bold text-ink"
          >
            {title}
          </h2>
          <p id="unsaved-changes-body" className="mt-1.5 text-sm text-ink/70">
            {body}
          </p>
        </div>
        <div className="flex flex-col-reverse gap-2 px-5 py-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onStay}
            className="rounded-xl border border-ink/20 px-4 py-2 text-sm font-semibold text-ink transition hover:border-ink/30"
          >
            {stayLabel}
          </button>
          <button
            type="button"
            onClick={onLeave}
            className="rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-night transition hover:brightness-110"
          >
            {leaveLabel}
          </button>
        </div>
      </div>
    </div>
  );

  // Portal to <body>: a `fixed` element confined to an ancestor that has a
  // CSS transform (even a no-op one, e.g. Tailwind's `animate-fade-up`
  // keyframe ends on `translateY(0)` with fill-mode `both`, so it stays
  // applied after the animation finishes) only covers that ancestor's box,
  // not the real viewport. Opacity-only fade keeps `fixed` covering the
  // viewport.
  if (typeof document === "undefined") return null;
  return createPortal(dialog, document.body);
}
