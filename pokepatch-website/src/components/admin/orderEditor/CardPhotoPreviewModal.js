"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  overlayFadeClassName,
  useOverlayPresence,
} from "@/components/ExpandReveal";

function ArrowIcon({ direction }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      {direction === "left" ? (
        <path d="M15 18l-6-6 6-6" />
      ) : (
        <path d="M9 18l6-6-6-6" />
      )}
    </svg>
  );
}

const TOOLBAR_BUTTON_CLASS =
  "inline-flex h-8 items-center rounded-lg border border-ink/20 px-3 text-xs font-semibold text-ink transition hover:bg-ink/10 disabled:cursor-not-allowed disabled:opacity-40";

/**
 * Admin-only photo reference viewer for one order card.
 * Opens with every photo laid out by group; clicking a photo shows the
 * full-resolution file at its original pixel size (toggle to fit-to-screen).
 *
 * `groups`: [{ key, title, items }] where items come from `savedPhotoItems`.
 * Nothing here is rendered for customers — the images only load on open.
 */
export default function CardPhotoPreviewModal({
  open,
  onClose,
  title,
  groups,
}) {
  const [expandedIndex, setExpandedIndex] = useState(null);
  const [fitToScreen, setFitToScreen] = useState(false);
  const { mounted, visible } = useOverlayPresence(open);

  const flatItems = useMemo(
    () =>
      (groups ?? []).flatMap((group) =>
        (group.items ?? []).map((item) => ({
          ...item,
          groupTitle: group.title,
        }))
      ),
    [groups]
  );

  const total = flatItems.length;
  const expandedItem =
    expandedIndex != null ? flatItems[expandedIndex] ?? null : null;

  // Fresh grid every time the modal reopens.
  const requestClose = useCallback(() => {
    setExpandedIndex(null);
    setFitToScreen(false);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;

    function onKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (expandedIndex != null) {
          setExpandedIndex(null);
        } else {
          requestClose();
        }
      } else if (event.key === "ArrowLeft" && expandedIndex != null) {
        setExpandedIndex((current) =>
          current == null || current <= 0 ? current : current - 1
        );
      } else if (event.key === "ArrowRight" && expandedIndex != null) {
        setExpandedIndex((current) =>
          current == null || current >= total - 1 ? current : current + 1
        );
      }
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, expandedIndex, total, requestClose]);

  if (!mounted) return null;
  if (typeof document === "undefined") return null;

  const hasPrevious = expandedIndex != null && expandedIndex > 0;
  const hasNext = expandedIndex != null && expandedIndex < total - 1;

  function openItem(itemId) {
    const index = flatItems.findIndex(
      (item) => String(item.id) === String(itemId)
    );
    if (index >= 0) setExpandedIndex(index);
  }

  const header = (
    <div className="flex shrink-0 items-center gap-3 border-b border-ink/10 px-4 py-3 sm:px-5">
      {expandedItem ? (
        <button
          type="button"
          onClick={() => setExpandedIndex(null)}
          className={TOOLBAR_BUTTON_CLASS}
        >
          ← All photos
        </button>
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink">
          {expandedItem ? expandedItem.label || expandedItem.alt : title}
        </p>
        <p className="mt-0.5 truncate font-mono text-[10px] uppercase tracking-[0.14em] text-ink/45">
          {expandedItem
            ? `${expandedItem.groupTitle} · ${expandedIndex + 1} of ${total}`
            : `${total} photo${total === 1 ? "" : "s"}`}
        </p>
      </div>
      {expandedItem ? (
        <button
          type="button"
          onClick={() => setFitToScreen((value) => !value)}
          aria-pressed={fitToScreen}
          className={TOOLBAR_BUTTON_CLASS}
        >
          {fitToScreen ? "Original size" : "Fit to screen"}
        </button>
      ) : null}
      <button
        type="button"
        onClick={requestClose}
        className={TOOLBAR_BUTTON_CLASS}
        aria-label="Close preview"
      >
        Close
      </button>
    </div>
  );

  const gridBody = (
    <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-4 sm:px-5">
      {total === 0 ? (
        <p className="text-sm text-ink/50">No photos on this card yet.</p>
      ) : null}
      {(groups ?? []).map((group) => {
        const items = group.items ?? [];
        if (items.length === 0) return null;
        return (
          <section key={group.key}>
            <h3 className="mb-2 flex items-baseline gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-ink/45">
              {group.title}
              <span className="font-mono text-ink/35">{items.length}</span>
            </h3>
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="overflow-hidden rounded-xl bg-night/40 ring-1 ring-ink/10"
                >
                  <button
                    type="button"
                    onClick={() => openItem(item.id)}
                    disabled={!item.src}
                    className="block w-full cursor-zoom-in text-left disabled:cursor-default"
                    aria-label={`Expand ${item.alt || "photo"}`}
                  >
                    <span className="flex aspect-[3/4] w-full items-center justify-center bg-night/50 p-1">
                      {item.src ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.src}
                          alt={item.alt}
                          decoding="async"
                          className="max-h-full max-w-full object-contain"
                        />
                      ) : (
                        <span className="text-xs text-ink/40">Unavailable</span>
                      )}
                    </span>
                    {item.label ? (
                      <span className="block truncate px-2 py-1.5 text-[11px] text-ink/70">
                        {item.label}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );

  const expandedBody = expandedItem ? (
    <div className="relative min-h-0 flex-1">
      <div className="h-full w-full overflow-auto">
        <div className="flex min-h-full min-w-full p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={expandedItem.fullSrc || expandedItem.src}
            src={expandedItem.fullSrc || expandedItem.src}
            alt={expandedItem.alt}
            decoding="async"
            onClick={() => setFitToScreen((value) => !value)}
            title={fitToScreen ? "Show original size" : "Fit to screen"}
            className={
              fitToScreen
                ? "m-auto max-h-full max-w-full cursor-zoom-in object-contain"
                : "m-auto block max-w-none cursor-zoom-out"
            }
          />
        </div>
      </div>
      {hasPrevious ? (
        <button
          type="button"
          onClick={() => setExpandedIndex((current) => current - 1)}
          className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-night/70 p-2.5 text-ink ring-1 ring-ink/20 transition hover:bg-night"
          aria-label="Previous photo"
        >
          <ArrowIcon direction="left" />
        </button>
      ) : null}
      {hasNext ? (
        <button
          type="button"
          onClick={() => setExpandedIndex((current) => current + 1)}
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-night/70 p-2.5 text-ink ring-1 ring-ink/20 transition hover:bg-night"
          aria-label="Next photo"
        >
          <ArrowIcon direction="right" />
        </button>
      ) : null}
    </div>
  ) : null;

  const dialog = (
    <div
      className={`fixed inset-0 z-[300] flex items-center justify-center bg-night/80 p-3 sm:p-6 ${overlayFadeClassName(visible)}`}
      role="presentation"
      onClick={requestClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-ink/15 bg-cream"
        onClick={(event) => event.stopPropagation()}
      >
        {header}
        {expandedItem ? expandedBody : gridBody}
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
}
