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

const REMOVE_BUTTON_CLASS =
  "inline-flex h-8 items-center rounded-lg border border-error/35 bg-error/10 px-3 text-xs font-semibold text-error transition hover:bg-error/20 disabled:cursor-not-allowed disabled:opacity-40";

/**
 * Admin-only photo reference viewer for one order card.
 * Opens with every photo laid out by group; clicking a photo shows the
 * full-resolution file scaled to fit the screen.
 *
 * `groups`: [{ key, title, items }] where items come from `savedPhotoItems`.
 * Nothing here is rendered for customers — the images only load on open.
 *
 * Pass `onRemove` + `removableGroupKeys` to stage deletes (Save & Confirm).
 */
export default function CardPhotoPreviewModal({
  open,
  onClose,
  title,
  groups = [],
  onRemove,
  removableGroupKeys = ["before", "after"],
}) {
  const [expandedIndex, setExpandedIndex] = useState(null);
  const { mounted, visible } = useOverlayPresence(open);

  const removableKeys = useMemo(
    () => new Set(removableGroupKeys ?? []),
    [removableGroupKeys]
  );

  const flatItems = useMemo(
    () =>
      groups.flatMap((group) =>
        group.items.map((item) => ({
          ...item,
          groupTitle: group.title,
          canRemove:
            typeof onRemove === "function" && removableKeys.has(group.key),
        }))
      ),
    [groups, onRemove, removableKeys]
  );

  const total = flatItems.length;
  const expandedItem =
    expandedIndex != null ? flatItems[expandedIndex] ?? null : null;

  // Fresh grid every time the modal reopens.
  const requestClose = useCallback(() => {
    setExpandedIndex(null);
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

  // Keep expanded index valid when the parent removes items from the draft.
  useEffect(() => {
    if (expandedIndex == null) return;
    if (total === 0) {
      setExpandedIndex(null);
      return;
    }
    if (expandedIndex >= total) {
      setExpandedIndex(total - 1);
    }
  }, [expandedIndex, total]);

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

  function handleRemove(itemId) {
    if (typeof onRemove !== "function" || itemId == null) return;
    const removingExpanded =
      expandedItem != null && String(expandedItem.id) === String(itemId);
    onRemove(itemId);
    if (removingExpanded) {
      setExpandedIndex((current) => {
        if (current == null) return null;
        if (total <= 1) return null;
        if (current >= total - 1) return current - 1;
        return current;
      });
    }
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
      {expandedItem?.canRemove ? (
        <button
          type="button"
          onClick={() => handleRemove(expandedItem.id)}
          className={REMOVE_BUTTON_CLASS}
        >
          Remove
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

  // Groups sit side by side and wrap; the dialog hugs this content so a card
  // with a handful of photos gets a compact, centered panel instead of a
  // mostly-empty full-height one.
  const gridBody = (
    <div className="flex min-h-0 flex-1 flex-wrap items-start justify-center gap-x-10 gap-y-6 overflow-y-auto px-5 py-5 sm:px-8">
      {total === 0 ? (
        <p className="text-sm text-ink/50">No photos on this card yet.</p>
      ) : null}
      {groups.map((group) => {
        const { items } = group;
        if (items.length === 0) return null;
        const groupRemovable =
          typeof onRemove === "function" && removableKeys.has(group.key);
        return (
          <section key={group.key} className="flex flex-col items-center">
            <h3 className="mb-2.5 flex items-baseline gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-ink/45">
              {group.title}
              <span className="font-mono text-ink/35">{items.length}</span>
            </h3>
            <ul className="flex flex-wrap justify-center gap-3">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="w-40 overflow-hidden rounded-xl bg-night/40 ring-1 ring-ink/10"
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
                  {groupRemovable ? (
                    <div className="border-t border-ink/10 px-2 py-1.5">
                      <button
                        type="button"
                        onClick={() => handleRemove(item.id)}
                        className="w-full rounded-md px-2 py-1 text-[11px] font-semibold text-error transition hover:bg-error/10"
                      >
                        Remove
                      </button>
                    </div>
                  ) : null}
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
      {/*
        Wrapper takes the full dialog body so max-h/max-w resolve against a
        definite size and the image always fits on screen.
      */}
      <div className="flex h-full w-full items-center justify-center p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={expandedItem.fullSrc || expandedItem.src}
          src={expandedItem.fullSrc || expandedItem.src}
          alt={expandedItem.alt}
          decoding="async"
          className="max-h-full max-w-full object-contain"
        />
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
        className={`flex max-w-6xl flex-col overflow-hidden rounded-2xl border border-ink/15 bg-cream ${
          expandedItem
            ? "h-full w-full"
            : "max-h-full w-auto min-w-[min(100%,24rem)]"
        }`}
        onClick={(event) => event.stopPropagation()}
      >
        {header}
        {expandedItem ? expandedBody : gridBody}
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
}
