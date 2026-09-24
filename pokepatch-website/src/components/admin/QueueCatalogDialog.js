"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import OrderCardCatalogThumb from "@/components/admin/OrderCardCatalogThumb";
import {
  overlayFadeClassName,
  useOverlayPresence,
} from "@/components/ExpandReveal";
import { adminGetOrder } from "@/lib/adminApi";
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

/**
 * Shown when an order is dragged into the To do / queue column.
 * Lets admin attach official catalog art before the move/notify prompt.
 */
export default function QueueCatalogDialog({
  open,
  orderId,
  displayId,
  onCancel,
  onContinue,
}) {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState(null);

  const { mounted, visible } = useOverlayPresence(open);

  useEffect(() => {
    if (!open || !orderId) return undefined;

    let cancelled = false;
    setLoading(true);
    setError("");
    setExpandedId(null);

    adminGetOrder(orderId)
      .then((order) => {
        if (cancelled) return;
        const next = (order?.cards ?? [])
          .filter((card) => normalizeCardStatus(card.status) !== "canceled")
          .map((card) => ({
            id: card.id,
            card_name: card.card_name ?? "",
            set_name: card.set_name ?? "",
            tcg_card_id: card.tcg_card_id ?? "",
            catalog_image_url: card.catalog_image_url ?? "",
          }));
        setCards(next);
        if (next.length === 1) setExpandedId(String(next[0].id));
      })
      .catch((err) => {
        if (cancelled) return;
        setCards([]);
        setError(
          err instanceof Error ? err.message : "Could not load order cards."
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, orderId]);

  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(event) {
      if (event.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel]);

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
      onClick={onCancel}
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
          <p className="mt-1 text-xs text-ink/50">
            Official card art for the public queue page — not customer photos.
            Continue without art if you prefer to add it later.
          </p>
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
            const name = (card.card_name ?? "").trim() || "Untitled card";
            const set = (card.set_name ?? "").trim();

            return (
              <div
                key={id}
                className={`overflow-hidden rounded-xl border ${
                  expanded ? "border-ink/25 bg-ink/[0.03]" : "border-ink/10"
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
                    ) : null}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-ink/40">
                    {expanded ? "Hide" : preview ? "Edit" : "Add art"}
                  </span>
                </button>

                {expanded ? (
                  <div className="border-t border-ink/10 px-3 pb-3 pt-3">
                    <OrderCardCatalogThumb
                      cardId={card.id}
                      cardName={card.card_name}
                      setName={card.set_name}
                      tcgCardId={card.tcg_card_id}
                      catalogImageUrl={card.catalog_image_url}
                      onApplied={(updated) => {
                        setCards((current) =>
                          current.map((entry) =>
                            String(entry.id) === id
                              ? {
                                  ...entry,
                                  tcg_card_id: updated.tcg_card_id ?? "",
                                  catalog_image_url:
                                    updated.catalog_image_url ?? "",
                                }
                              : entry
                          )
                        );
                      }}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-ink/10 px-5 py-4">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-ink/20 px-4 py-2 text-sm font-semibold text-ink transition hover:border-ink/30"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onContinue}
            className="rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-night transition hover:brightness-110"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
}
