"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import {
  overlayFadeClassName,
  useOverlayPresence,
} from "@/components/ExpandReveal";
import { PRIORITY_FEE_PER_CARD, formatMoney } from "@/lib/servicePricing";

/**
 * Confirm before create/save when some cards are priority and some are not.
 * Mixed carts become two orders (priority + standard).
 */
export default function PrioritySplitDialog({
  open,
  priorityCount = 0,
  standardCount = 0,
  onCancel,
  onConfirm,
  confirmLabel = "Continue",
}) {
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

  const priorityFee = priorityCount * PRIORITY_FEE_PER_CARD;

  const dialog = (
    <div
      className={`fixed inset-0 z-[300] flex items-center justify-center bg-night/70 px-4 py-6 ${overlayFadeClassName(visible)}`}
      role="presentation"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="priority-split-title"
        aria-describedby="priority-split-body"
        className="w-full max-w-md overflow-hidden rounded-2xl border border-ink/15 bg-cream"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-ink/10 px-5 py-4">
          <h2
            id="priority-split-title"
            className="text-xl font-bold text-ink"
          >
            This will split into two orders
          </h2>
          <p
            id="priority-split-body"
            className="mt-1.5 text-sm leading-relaxed text-ink/70"
          >
            Priority cards become their own order (
            {priorityCount === 1 ? "1 card" : `${priorityCount} cards`},{" "}
            {formatMoney(priorityFee)} priority fee). The rest stay on a
            standard order (
            {standardCount === 1 ? "1 card" : `${standardCount} cards`}).
            Both show up under My Orders.
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
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(dialog, document.body);
}
