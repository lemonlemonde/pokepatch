"use client";

import { useRef, useState } from "react";
import GalleryCardSearch from "@/components/admin/GalleryCardSearch";
import {
  adminApplyOrderCardTcg,
  adminClearOrderCardCatalog,
  adminUploadOrderCardCatalog,
} from "@/lib/adminApi";
import { CARD_THUMB_ASPECT_CLASS, CARD_THUMB_IMAGE_CLASS } from "@/lib/gallery";
import { tcgCardImageUrl } from "@/lib/tcgCardImage";

/**
 * Admin controls for the public-queue catalog thumbnail on an order card.
 * Uses official TCG art (or a manual upload) — never customer photos.
 */
export default function OrderCardCatalogThumb({
  cardId,
  cardName = "",
  setName = "",
  tcgCardId = "",
  catalogImageUrl = "",
  disabled = false,
  onApplied,
}) {
  const [selectedCard, setSelectedCard] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef(null);

  const previewUrl =
    catalogImageUrl ||
    (tcgCardId ? tcgCardImageUrl({ id: tcgCardId }) : "") ||
    (selectedCard ? tcgCardImageUrl(selectedCard) : "");

  async function handleConfirm(card) {
    if (!card?.id || disabled) return;
    setConfirming(true);
    setError("");
    try {
      const updated = await adminApplyOrderCardTcg(cardId, card.id);
      onApplied?.(updated);
      setSelectedCard(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not apply thumbnail.");
    } finally {
      setConfirming(false);
    }
  }

  async function handleClear() {
    if (disabled) return;
    setClearing(true);
    setError("");
    try {
      const updated = await adminClearOrderCardCatalog(cardId);
      onApplied?.(updated);
      setSelectedCard(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not clear thumbnail.");
    } finally {
      setClearing(false);
    }
  }

  async function handleFileChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || disabled) return;
    setUploading(true);
    setError("");
    try {
      const updated = await adminUploadOrderCardCatalog(cardId, file);
      onApplied?.(updated);
      setSelectedCard(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload thumbnail.");
    } finally {
      setUploading(false);
    }
  }

  const busy = disabled || confirming || uploading || clearing;

  return (
    <div className="space-y-3 rounded-lg border border-ink/10 bg-ink/[0.02] p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink/45">
            Queue catalog image
          </p>
          <p className="mt-1 text-xs text-ink/50">
            Official card art for the public queue — not customer photos.
          </p>
        </div>
        {previewUrl ? (
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt=""
              className={`w-14 shrink-0 rounded border border-ink/10 bg-night/20 ${CARD_THUMB_ASPECT_CLASS} ${CARD_THUMB_IMAGE_CLASS}`}
            />
            <button
              type="button"
              disabled={busy || (!catalogImageUrl && !tcgCardId)}
              onClick={handleClear}
              className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink/45 transition hover:text-ink disabled:opacity-50"
            >
              {clearing ? "Clearing…" : "Clear"}
            </button>
          </div>
        ) : null}
      </div>

      {error ? <p className="text-xs font-semibold text-error">{error}</p> : null}

      <GalleryCardSearch
        key={`${cardId}-${cardName}-${setName}`}
        selectedCard={selectedCard}
        appliedCardId={tcgCardId}
        onSelect={setSelectedCard}
        onConfirm={handleConfirm}
        onClear={() => setSelectedCard(null)}
        confirming={confirming}
        initialCardName={cardName}
        initialSetName={setName}
        disabled={busy}
      />

      <div className="flex flex-wrap items-center gap-3 border-t border-ink/10 pt-3">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/webp,image/jpeg,image/png"
          className="hidden"
          onChange={handleFileChange}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
          className="rounded-lg border border-ink/15 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink/70 transition hover:border-ink/35 hover:text-ink disabled:opacity-50"
        >
          {uploading ? "Uploading…" : "Upload own image"}
        </button>
        <p className="text-[11px] text-ink/40">
          WebP, JPEG, or PNG — replaces API art on the queue page.
        </p>
      </div>
    </div>
  );
}
