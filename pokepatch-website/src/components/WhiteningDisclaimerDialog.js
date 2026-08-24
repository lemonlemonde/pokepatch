"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import {
  overlayFadeClassName,
  useOverlayPresence,
} from "@/components/ExpandReveal";
import { CARD_WHITENING_WARNING } from "@/lib/servicePricing";

export default function WhiteningDisclaimerDialog({ open, onCancel, onConfirm }) {
  const { mounted, visible } = useOverlayPresence(open);

  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(event) {
      if (event.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel]);

  if (!mounted) return null;

  const dialog = (
    <div
      className={`fixed inset-0 z-[300] flex items-center justify-center bg-night/70 px-4 py-6 ${overlayFadeClassName(visible)}`}
      role="presentation"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="whitening-disclaimer-title"
        aria-describedby="whitening-disclaimer-body"
        className="w-full max-w-md overflow-hidden rounded-2xl border border-ink/15 bg-cream"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-ink/10 px-5 py-4">
          <h2
            id="whitening-disclaimer-title"
            className="text-xl font-bold text-ink"
          >
            Card Whitening disclaimer
          </h2>
          <p
            id="whitening-disclaimer-body"
            className="mt-1.5 text-sm leading-relaxed text-ink/70"
          >
            {CARD_WHITENING_WARNING}
          </p>
        </div>
        <div className="flex flex-col-reverse gap-2 px-5 py-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-ink/20 px-4 py-2 text-sm font-semibold text-ink transition hover:border-ink/30"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-night transition hover:brightness-110"
          >
            I understand
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(dialog, document.body);
}
