"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

function moveId(ids, fromId, toId) {
  const from = ids.findIndex((id) => String(id) === String(fromId));
  const to = ids.findIndex((id) => String(id) === String(toId));
  if (from < 0 || to < 0 || from === to) return ids;
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * Admin-only photo reference viewer for one order card.
 * Opens with every photo laid out by group; clicking a photo shows the
 * full-resolution file scaled to fit the screen.
 *
 * `groups`: [{ key, title, items }] where items come from `savedPhotoItems`.
 * Nothing here is rendered for customers — the images only load on open.
 *
 * Pass `onRemove` + `removableGroupKeys` to hard-delete before/after photos
 * (Remove asks for confirmation first).
 *
 * Pass `onReorder` to drag photos within a group (before/after independently).
 */
export default function CardPhotoPreviewModal({
  open,
  onClose,
  title,
  groups = [],
  onRemove,
  onReorder,
  removableGroupKeys = ["before", "after"],
  reorderableGroupKeys = ["before", "after"],
}) {
  const [expandedIndex, setExpandedIndex] = useState(null);
  const [draggingId, setDraggingId] = useState(null);
  const [dropTargetId, setDropTargetId] = useState(null);
  const [dragOpen, setDragOpen] = useState(open);
  const dragIdRef = useRef(null);
  const dragGroupRef = useRef(null);
  const ignoreClickRef = useRef(false);
  const { mounted, visible } = useOverlayPresence(open);

  if (open !== dragOpen) {
    setDragOpen(open);
    if (draggingId != null) setDraggingId(null);
    if (dropTargetId != null) setDropTargetId(null);
  }

  const removableKeys = useMemo(
    () => new Set(removableGroupKeys ?? []),
    [removableGroupKeys]
  );
  const reorderableKeys = useMemo(
    () => new Set(reorderableGroupKeys ?? []),
    [reorderableGroupKeys]
  );
  const canReorderGroups =
    typeof onReorder === "function" &&
    groups.some(
      (group) => reorderableKeys.has(group.key) && group.items.length > 1
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
  if (expandedIndex != null && total === 0) {
    setExpandedIndex(null);
  } else if (expandedIndex != null && expandedIndex >= total) {
    setExpandedIndex(total - 1);
  }
  const expandedItem =
    expandedIndex != null ? flatItems[expandedIndex] ?? null : null;

  const clearDrag = useCallback(() => {
    dragIdRef.current = null;
    dragGroupRef.current = null;
    setDraggingId(null);
    setDropTargetId(null);
  }, []);

  // Fresh grid every time the modal reopens.
  const requestClose = useCallback(() => {
    setExpandedIndex(null);
    clearDrag();
    onClose();
  }, [onClose, clearDrag]);

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
    if (ignoreClickRef.current) {
      ignoreClickRef.current = false;
      return;
    }
    const index = flatItems.findIndex(
      (item) => String(item.id) === String(itemId)
    );
    if (index >= 0) setExpandedIndex(index);
  }

  function handleDragStart(event, groupKey, itemId) {
    dragIdRef.current = String(itemId);
    dragGroupRef.current = groupKey;
    ignoreClickRef.current = true;
    setDraggingId(String(itemId));
    setDropTargetId(null);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(itemId));
  }

  function handleDragOver(event, groupKey, itemId) {
    if (dragGroupRef.current !== groupKey) {
      if (dropTargetId != null) setDropTargetId(null);
      return;
    }
    if (!dragIdRef.current) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const targetId = String(itemId);
    if (targetId === dragIdRef.current) {
      if (dropTargetId != null) setDropTargetId(null);
      return;
    }
    if (dropTargetId !== targetId) setDropTargetId(targetId);
  }

  function handleDrop(event, groupKey, itemId, itemIds) {
    event.preventDefault();
    event.stopPropagation();
    const dragId = dragIdRef.current;
    const sameGroup = dragGroupRef.current === groupKey;
    clearDrag();
    if (!sameGroup || !dragId || typeof onReorder !== "function") return;
    const next = moveId(itemIds.map(String), dragId, itemId);
    if (next.every((id, index) => id === String(itemIds[index]))) return;
    onReorder(groupKey, next);
  }

  function handleDragEnd() {
    clearDrag();
    window.setTimeout(() => {
      ignoreClickRef.current = false;
    }, 0);
  }

  function handleRemove(itemId) {
    if (typeof onRemove !== "function" || itemId == null) return;
    if (
      !window.confirm(
        "Remove this photo permanently? It is deleted right away and cannot be undone."
      )
    ) {
      return;
    }
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
            : `${total} photo${total === 1 ? "" : "s"}${
                canReorderGroups ? " · drag to reorder" : ""
              }`}
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
        const groupReorderable =
          typeof onReorder === "function" &&
          reorderableKeys.has(group.key) &&
          items.length > 1;
        const itemIds = items.map((item) => item.id);
        return (
          <section key={group.key} className="flex flex-col items-center">
            <h3 className="mb-2.5 flex items-baseline gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-ink/45">
              {group.title}
              <span className="font-mono text-ink/35">{items.length}</span>
            </h3>
            <ul className="flex flex-wrap justify-center gap-3">
              {items.map((item) => {
                const itemId = String(item.id);
                const isDragging = draggingId === itemId;
                const isDropTarget = dropTargetId === itemId && !isDragging;
                return (
                  <li
                    key={item.id}
                    onDragOver={
                      groupReorderable
                        ? (event) => handleDragOver(event, group.key, item.id)
                        : undefined
                    }
                    onDrop={
                      groupReorderable
                        ? (event) =>
                            handleDrop(event, group.key, item.id, itemIds)
                        : undefined
                    }
                    className={`w-40 overflow-hidden rounded-xl bg-night/40 transition ${
                      isDropTarget
                        ? "ring-2 ring-ink/55"
                        : "ring-1 ring-ink/10"
                    } ${isDragging ? "opacity-40" : ""}`}
                  >
                    <div
                      role="button"
                      tabIndex={item.src ? 0 : -1}
                      draggable={groupReorderable}
                      onDragStart={
                        groupReorderable
                          ? (event) =>
                              handleDragStart(event, group.key, item.id)
                          : undefined
                      }
                      onDragEnd={groupReorderable ? handleDragEnd : undefined}
                      onClick={() => item.src && openItem(item.id)}
                      onKeyDown={(event) => {
                        if (!item.src) return;
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openItem(item.id);
                        }
                      }}
                      aria-label={`Expand ${item.alt || "photo"}`}
                      aria-grabbed={
                        groupReorderable ? isDragging : undefined
                      }
                      className={`block w-full select-none text-left ${
                        !item.src
                          ? "cursor-default"
                          : groupReorderable
                            ? "cursor-grab active:cursor-grabbing"
                            : "cursor-zoom-in"
                      }`}
                    >
                      <span className="flex aspect-[3/4] w-full items-center justify-center bg-night/50 p-1">
                        {item.src ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={item.src}
                            alt={item.alt}
                            draggable={false}
                            decoding="async"
                            className="pointer-events-none max-h-full max-w-full object-contain"
                          />
                        ) : (
                          <span className="text-xs text-ink/40">
                            Unavailable
                          </span>
                        )}
                      </span>
                      {item.label ? (
                        <span className="block truncate px-2 py-1.5 text-[11px] text-ink/70">
                          {item.label}
                        </span>
                      ) : null}
                    </div>
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
                );
              })}
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
