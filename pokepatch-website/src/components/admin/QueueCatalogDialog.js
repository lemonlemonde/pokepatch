"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import OrderCardCatalogThumb from "@/components/admin/OrderCardCatalogThumb";
import {
  overlayFadeClassName,
  useOverlayPresence,
} from "@/components/ExpandReveal";
import { adminGetOrder, adminSetOrderCardLabels } from "@/lib/adminApi";
import { CARD_THUMB_ASPECT_CLASS, CARD_THUMB_IMAGE_CLASS } from "@/lib/gallery";
import { normalizeCardStatus } from "@/lib/orderStatus";
import { tcgCardImageUrl } from "@/lib/tcgCardImage";

function catalogPreviewUrl(card) {
  const url = (card?.catalog_image_url ?? "").trim();
  if (url) return url;
  const tcgId = (card?.tcg_card_id ?? "").trim();
  if (tcgId) return tcgCardImageUrl({ id: tcgId });
  return "";
}

function resolvedCardName(card) {
  return (
    (card?.catalog_card_name ?? "").trim() || (card?.card_name ?? "").trim()
  );
}

function resolvedSetName(card) {
  return (card?.catalog_set_name ?? "").trim() || (card?.set_name ?? "").trim();
}

function displayCardName(card) {
  return resolvedCardName(card) || "Untitled card";
}

function displaySetName(card) {
  return resolvedSetName(card);
}

function hasCatalogThumb(card) {
  return Boolean(catalogPreviewUrl(card));
}

function catalogFieldsFromPick(picked) {
  const name = (picked.name ?? "").trim();
  const set = (picked.set_name ?? "").trim();
  return {
    tcg_card_id: picked.id,
    catalog_image_url: tcgCardImageUrl(picked),
    catalog_card_name: name,
    catalog_set_name: set,
    // Official printing also becomes the order card's typed labels.
    card_name: name,
    set_name: set,
  };
}

function catalogFieldsFromApplied(updated) {
  return {
    tcg_card_id: updated.tcg_card_id ?? "",
    catalog_image_url: updated.catalog_image_url ?? "",
    catalog_card_name: updated.catalog_card_name ?? "",
    catalog_set_name: updated.catalog_set_name ?? "",
    card_name: updated.card_name ?? "",
    set_name: updated.set_name ?? "",
  };
}

function omitCardError(errors, id) {
  if (!errors[id]) return errors;
  const next = { ...errors };
  delete next[id];
  return next;
}

function missingRequirements(card) {
  const missing = [];
  if (!resolvedCardName(card)) missing.push("card name");
  if (!resolvedSetName(card)) missing.push("set");
  if (!hasCatalogThumb(card)) missing.push("thumbnail");
  return missing;
}

/**
 * Catalog art + official titles for the public queue.
 * `mode="move"` — before dragging into To do (Continue → move/notify).
 * `mode="publish"` — edit art/titles on an order already in the queue (Done closes).
 */
export default function QueueCatalogDialog({
  open,
  orderId,
  displayId,
  mode = "move",
  onCancel,
  onContinue,
}) {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const [cardErrors, setCardErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const revertByIdRef = useRef({});

  const { mounted, visible } = useOverlayPresence(open);
  const publishOnly = mode === "publish";

  useEffect(() => {
    if (!open || !orderId) return undefined;

    let cancelled = false;
    setLoading(true);

    adminGetOrder(orderId)
      .then((order) => {
        if (cancelled) return;
        const next = (order?.cards ?? [])
          .filter((card) => normalizeCardStatus(card.status) !== "canceled")
          .map((card) => {
            const catalogName = (card.catalog_card_name ?? "").trim();
            const catalogSet = (card.catalog_set_name ?? "").trim();
            const typedName = (card.card_name ?? "").trim();
            const typedSet = (card.set_name ?? "").trim();
            return {
              id: card.id,
              // Prefer official catalog labels in the editable fields when present.
              card_name: catalogName || typedName,
              set_name: catalogSet || typedSet,
              tcg_card_id: card.tcg_card_id ?? "",
              catalog_image_url: card.catalog_image_url ?? "",
              catalog_card_name: catalogName,
              catalog_set_name: catalogSet,
            };
          });
        setCards(next);
        setExpandedId(next.length === 1 ? String(next[0].id) : null);
        setCardErrors({});
        revertByIdRef.current = {};
        setError("");
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setCards([]);
        setExpandedId(null);
        setCardErrors({});
        revertByIdRef.current = {};
        setError(
          err instanceof Error ? err.message : "Could not load order cards."
        );
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, orderId]);

  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(event) {
      if (event.key === "Escape" && !saving) onCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel, saving]);

  function updateCardFields(id, patch) {
    setCards((current) =>
      current.map((row) => (String(row.id) === id ? { ...row, ...patch } : row))
    );
    setCardErrors((current) => omitCardError(current, id));
  }

  async function handleContinue() {
    if (publishOnly) {
      onContinue();
      return;
    }

    const nextErrors = {};
    for (const card of cards) {
      const missing = missingRequirements(card);
      if (missing.length > 0) {
        nextErrors[String(card.id)] = `Required: ${missing.join(", ")}.`;
      }
    }
    if (Object.keys(nextErrors).length > 0) {
      setCardErrors(nextErrors);
      const firstId = Object.keys(nextErrors)[0];
      setExpandedId(firstId);
      setError("Every card needs a name, set, and thumbnail before continuing.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      await Promise.all(
        cards.map((card) =>
          adminSetOrderCardLabels(
            card.id,
            resolvedCardName(card),
            resolvedSetName(card)
          )
        )
      );
      onContinue();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save card labels."
      );
    } finally {
      setSaving(false);
    }
  }

  if (!mounted) return null;
  if (typeof document === "undefined") return null;

  const title =
    displayId != null
      ? `Queue art · Order #${displayId}`
      : "Queue catalog art";

  const dialog = (
    <div
      className={`fixed inset-0 z-[300] flex items-center justify-center bg-night/70 px-4 py-6 ${overlayFadeClassName(visible)}`}
      role="presentation"
      onClick={() => {
        if (!saving) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="queue-catalog-dialog-title"
        className="flex max-h-[min(90vh,48rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-ink/15 bg-cream"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="shrink-0 border-b border-ink/10 px-5 py-4">
          <h2
            id="queue-catalog-dialog-title"
            className="text-xl font-bold text-ink"
          >
            {title}
          </h2>
          {!publishOnly ? (
            <p className="mt-1 text-sm text-ink/55">
              Each card needs a name, set, and thumbnail before it can enter To
              do.
            </p>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {loading ? (
            <p className="text-sm text-ink/50">Loading cards…</p>
          ) : null}
          {error ? (
            <p className="rounded-xl border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
              {error}
            </p>
          ) : null}
          {!loading && !error && cards.length === 0 ? (
            <p className="text-sm text-ink/50">No active cards on this order.</p>
          ) : null}

          {cards.map((card, index) => {
            const id = String(card.id);
            const expanded = expandedId === id;
            const preview = catalogPreviewUrl(card);
            const name = displayCardName(card);
            const set = displaySetName(card);
            const incomplete = missingRequirements(card).length > 0;

            return (
              <div
                key={id}
                className={`overflow-hidden rounded-xl border ${
                  expanded
                    ? "border-ink/25 bg-ink/[0.03]"
                    : incomplete
                      ? "border-error/35"
                      : "border-ink/10"
                }`}
              >
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : id)}
                  aria-expanded={expanded}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
                >
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-ink/10 text-[11px] font-bold tabular-nums text-ink/55">
                    {index + 1}
                  </span>
                  <div
                    className={`h-12 w-9 shrink-0 overflow-hidden rounded border border-ink/10 bg-night/20 ${CARD_THUMB_ASPECT_CLASS}`}
                  >
                    {preview ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={preview}
                        alt=""
                        className={`h-full w-full ${CARD_THUMB_IMAGE_CLASS}`}
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center font-mono text-[8px] uppercase tracking-wide text-ink/30">
                        —
                      </div>
                    )}
                  </div>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">
                      {name}
                    </span>
                    {set ? (
                      <span className="mt-0.5 block truncate text-xs text-ink/50">
                        {set}
                      </span>
                    ) : (
                      <span className="mt-0.5 block truncate text-xs text-error/80">
                        Set required
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-ink/40">
                    {expanded ? "Hide" : preview ? "Edit" : "Add art"}
                  </span>
                </button>

                {cardErrors[id] && !expanded ? (
                  <p className="border-t border-error/20 px-3 py-2 text-xs font-semibold text-error">
                    {cardErrors[id]}
                  </p>
                ) : null}

                {expanded ? (
                  <div className="space-y-3 border-t border-ink/10 px-3 pb-3 pt-3">
                    {cardErrors[id] ? (
                      <p className="text-xs font-semibold text-error">
                        {cardErrors[id]}
                      </p>
                    ) : null}

                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block space-y-1">
                        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink/45">
                          Card name
                        </span>
                        <input
                          type="text"
                          value={card.card_name ?? ""}
                          disabled={saving}
                          onChange={(event) =>
                            updateCardFields(id, {
                              card_name: event.target.value,
                              catalog_card_name: event.target.value,
                            })
                          }
                          className="w-full rounded-lg border border-ink/15 bg-cream px-3 py-2 text-sm text-ink outline-none transition focus:border-ink/40"
                          placeholder="Required"
                        />
                      </label>
                      <label className="block space-y-1">
                        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink/45">
                          Set
                        </span>
                        <input
                          type="text"
                          value={card.set_name ?? ""}
                          disabled={saving}
                          onChange={(event) =>
                            updateCardFields(id, {
                              set_name: event.target.value,
                              catalog_set_name: event.target.value,
                            })
                          }
                          className="w-full rounded-lg border border-ink/15 bg-cream px-3 py-2 text-sm text-ink outline-none transition focus:border-ink/40"
                          placeholder="Required"
                        />
                      </label>
                    </div>

                    <OrderCardCatalogThumb
                      cardId={card.id}
                      cardName={card.card_name}
                      setName={card.set_name}
                      tcgCardId={card.tcg_card_id}
                      catalogImageUrl={card.catalog_image_url}
                      disabled={saving}
                      onSelecting={(picked) => {
                        setCards((current) => {
                          const entry = current.find(
                            (row) => String(row.id) === id
                          );
                          if (entry) revertByIdRef.current[id] = entry;
                          const fields = catalogFieldsFromPick(picked);
                          return current.map((row) =>
                            String(row.id) === id
                              ? {
                                  ...row,
                                  ...fields,
                                  card_name: fields.card_name || row.card_name,
                                  set_name: fields.set_name || row.set_name,
                                }
                              : row
                          );
                        });
                        setCardErrors((current) => omitCardError(current, id));
                        setExpandedId(null);
                      }}
                      onApplied={(updated) => {
                        delete revertByIdRef.current[id];
                        const fields = catalogFieldsFromApplied(updated);
                        setCards((current) =>
                          current.map((entry) =>
                            String(entry.id) === id
                              ? { ...entry, ...fields }
                              : entry
                          )
                        );
                        setCardErrors((current) => omitCardError(current, id));
                        if (
                          String(fields.tcg_card_id).trim() ||
                          String(fields.catalog_image_url).trim()
                        ) {
                          setExpandedId(null);
                        }
                      }}
                      onApplyFailed={(message) => {
                        const snapshot = revertByIdRef.current[id];
                        delete revertByIdRef.current[id];
                        if (snapshot) {
                          setCards((current) =>
                            current.map((entry) =>
                              String(entry.id) === id ? snapshot : entry
                            )
                          );
                        }
                        setCardErrors((current) => ({
                          ...current,
                          [id]: message,
                        }));
                        setExpandedId(id);
                      }}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-ink/10 px-5 py-4">
          {publishOnly ? (
            <button
              type="button"
              onClick={onContinue}
              disabled={saving}
              className="rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-night transition hover:brightness-110 disabled:opacity-50"
            >
              Done
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onCancel}
                disabled={saving}
                className="rounded-xl border border-ink/20 px-4 py-2 text-sm font-semibold text-ink transition hover:border-ink/30 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleContinue();
                }}
                disabled={saving || loading || cards.length === 0}
                className="rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-night transition hover:brightness-110 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Continue"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
}
