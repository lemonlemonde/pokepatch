"use client";

import { useEffect, useMemo, useState } from "react";
import { AdminOrderCardPhotoGroups } from "@/components/CardPhotoPreviews";
import { adminDeletePhoto } from "@/lib/adminApi";
import {
  QUOTE_SERVICES,
  SERVICE_KEYS,
  CARD_WHITENING_WARNING,
  HV_TIER_RANGES_LABEL,
  defaultBaseAmount,
  defaultServiceLabel,
  formatMoney,
  quoteCardHvAmount,
  serviceAccent,
  serviceAccentChipClass,
  serviceAccentDotClass,
  serviceAccentPanelClass,
  serviceSelectLabel,
} from "@/lib/servicePricing";
import { DAMAGE_TAGS, labeledDamageTags, normalizeDamageTags } from "@/lib/gallery";
import {
  CARD_STATUSES,
  cardStatusBadgeClass,
  normalizeCardStatus,
} from "@/lib/orderStatus";
import {
  MAX_ADMIN_PHOTOS_PER_CARD,
  applyCardHvFromMarket,
  copyFileList,
  emptyQuoteItem,
  moneyFieldToPayload,
  newClientId,
  quoteItemBelongsToCard,
  quoteItemHasService,
  quoteItemIsReady,
} from "@/lib/adminOrderDraft";
import { useOrderEditor } from "@/components/admin/orderEditor/OrderEditorContext";
import {
  AdminNoteField,
  Chevron,
  EditorDivider,
  EditorLabel,
  FieldGrid,
  GhostButton,
  RemoveButton,
  editorFieldClass,
} from "@/components/admin/orderEditor/editorUi";
import { savedPhotoItems } from "@/components/admin/orderEditor/photoUtils";
import { ExpandChevron, ExpandPanel } from "@/components/ExpandReveal";

function DamageTagChips({ tags, className }) {
  return tags.map((tag) => (
    <span key={tag.id} className={className}>
      {tag.label}
    </span>
  ));
}

function pickCardSection(cardId, draft) {
  const card =
    draft.cards.find((entry) => String(entry.id) === String(cardId)) ?? null;
  if (!card) return null;
  const quote_items = (draft.quote_items ?? [])
    .filter((item) => quoteItemBelongsToCard(item, card, draft.cards))
    .map((item) => ({ ...item }));
  const hv = draft.quote_card_hv?.[String(cardId)];
  return {
    card: { ...card, pending_files: [...(card.pending_files ?? [])] },
    quote_items,
    quote_card_hv: hv ? { [String(cardId)]: { ...hv } } : {},
  };
}

function applyCardSection(full, section, cardId) {
  const id = String(cardId);
  const cards = full.cards.map((card) =>
    String(card.id) === id ? section.card : card
  );
  const otherItems = (full.quote_items ?? []).filter((item) => {
    const card = cards.find((entry) => String(entry.id) === id);
    return !quoteItemBelongsToCard(item, card, cards);
  });
  const quote_items = [...otherItems, ...section.quote_items];
  const quote_card_hv = { ...(full.quote_card_hv ?? {}), ...section.quote_card_hv };
  if (!section.quote_card_hv[id]) {
    delete quote_card_hv[id];
  }
  return { ...full, cards, quote_items, quote_card_hv };
}

export default function CardDetailSection({
  cardId,
  cardIndex,
  onRemoveCard,
  expanded,
  onExpandedChange,
}) {
  const [expandedQuoteLineId, setExpandedQuoteLineId] = useState(null);
  const [removingPhotoId, setRemovingPhotoId] = useState(null);
  const [photoError, setPhotoError] = useState("");
  const {
    draft,
    updateDraft,
    applyServerPatch,
    saving,
    orderId,
    order,
    onOrderUpdated,
  } = useOrderEditor();

  const section = useMemo(() => pickCardSection(cardId, draft), [cardId, draft]);
  const card = section?.card;
  const quoteItems = useMemo(() => section?.quote_items ?? [], [section]);

  function updateCardSection(updater) {
    updateDraft((full) => {
      const current = pickCardSection(cardId, full);
      if (!current) return full;
      const nextSection =
        typeof updater === "function" ? updater(current) : { ...current, ...updater };
      return applyCardSection(full, nextSection, cardId);
    });
  }

  useEffect(() => {
    if (!expandedQuoteLineId) return;
    function onPointerDown(event) {
      const root = document.querySelector(
        `[data-quote-line-id="${CSS.escape(String(expandedQuoteLineId))}"]`
      );
      if (root && root.contains(event.target)) return;
      const item = quoteItems.find(
        (entry) => String(entry.id) === String(expandedQuoteLineId)
      );
      if (item && quoteItemIsReady(item)) {
        setExpandedQuoteLineId(null);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [expandedQuoteLineId, quoteItems]);

  if (!card) return null;

  const cardIdStr = String(card.id);
  const pendingFiles = card.pending_files ?? [];
  const photoInputId = `admin-card-photos-${card.id}`;

  function updateCard(patch) {
    updateCardSection((current) => {
      let nextCard = { ...current.card, ...patch };
      let quote_items = current.quote_items;
      let quote_card_hv = current.quote_card_hv ?? {};

      if ("card_name" in patch || "set_name" in patch) {
        quote_items = quote_items.map((item) => ({
          ...item,
          card_name: nextCard.card_name ?? "",
          set_name: nextCard.set_name ?? "",
        }));
      }
      if ("market_value_raw_nm" in patch) {
        const marketValue = moneyFieldToPayload(patch.market_value_raw_nm);
        quote_card_hv = applyCardHvFromMarket(
          { ...(draft.quote_card_hv ?? {}), ...quote_card_hv },
          cardIdStr,
          marketValue
        );
        if (!quote_card_hv[cardIdStr]) {
          const next = { ...quote_card_hv };
          delete next[cardIdStr];
          quote_card_hv = next;
        } else {
          quote_card_hv = { [cardIdStr]: quote_card_hv[cardIdStr] };
        }
      }

      return { card: nextCard, quote_items, quote_card_hv };
    });
  }

  function toggleDamageTag(tagId) {
    const current = normalizeDamageTags(card.damage_tags);
    const next = current.includes(tagId)
      ? current.filter((id) => id !== tagId)
      : [...current, tagId];
    updateCard({ damage_tags: next });
  }

  function updateQuoteItem(index, patch) {
    updateCardSection((current) => ({
      ...current,
      quote_items: current.quote_items.map((item, i) =>
        i === index ? { ...item, ...patch } : item
      ),
    }));
  }

  function addQuoteItem() {
    const next = emptyQuoteItem(card);
    updateCardSection((current) => ({
      ...current,
      quote_items: [...current.quote_items, next],
    }));
    setExpandedQuoteLineId(next.id);
  }

  function removeQuoteItem(index) {
    updateCardSection((current) => {
      let quote_items = current.quote_items.filter((_, i) => i !== index);
      const stillHasLine = quote_items.some((item) =>
        quoteItemBelongsToCard(item, current.card, draft.cards)
      );
      if (!stillHasLine) {
        quote_items = [...quote_items, emptyQuoteItem(current.card)];
      }
      return { ...current, quote_items };
    });
  }

  function applyServiceToQuoteItem(index, serviceKey) {
    if (!serviceKey) {
      updateQuoteItem(index, {
        service_key: "",
        service_label: "",
        quote_base_amount: "",
      });
      return;
    }
    const base = defaultBaseAmount(serviceKey);
    const label = defaultServiceLabel(serviceKey);
    updateQuoteItem(index, {
      service_key: serviceKey,
      service_label: serviceKey === SERVICE_KEYS.CUSTOM ? "" : label,
      quote_base_amount: base != null ? String(base) : "",
    });
    setExpandedQuoteLineId(quoteItems[index]?.id ?? null);
  }

  async function removePhoto(imageId) {
    if (!orderId || removingPhotoId != null) return;
    setRemovingPhotoId(imageId);
    setPhotoError("");
    const stripImage = (entry) => ({
      ...entry,
      images: (entry.images ?? []).filter(
        (image) => String(image.id) !== String(imageId)
      ),
    });
    try {
      await adminDeletePhoto(orderId, imageId);
      // The delete already happened server-side: update draft + baseline in
      // place so other unsaved edits survive and the order doesn't turn dirty.
      applyServerPatch((current) => ({
        ...current,
        cards: current.cards.map((entry) =>
          String(entry.id) === cardIdStr ? stripImage(entry) : entry
        ),
      }));
      onOrderUpdated({
        ...order,
        cards: (order.cards ?? []).map((entry) =>
          String(entry.id) === cardIdStr ? stripImage(entry) : entry
        ),
      });
    } catch (err) {
      setPhotoError(err.message || "Could not remove photo.");
    } finally {
      setRemovingPhotoId(null);
    }
  }

  function addPendingFiles(fileList) {
    const incoming = copyFileList(fileList).filter((file) =>
      file.type?.startsWith("image/")
    );
    if (incoming.length === 0) return;
    const nextPending = [
      ...pendingFiles,
      ...incoming.map((file) => ({ id: newClientId(), file })),
    ].slice(0, MAX_ADMIN_PHOTOS_PER_CARD);
    updateCard({ pending_files: nextPending });
  }

  const servicesSubtotal = quoteItems
    .filter(quoteItemIsReady)
    .reduce(
      (sum, item) => sum + (moneyFieldToPayload(item.quote_base_amount) ?? 0),
      0
    );
  const cardHv = quoteCardHvAmount({
    hv_amount: section.quote_card_hv?.[cardIdStr]?.amount_dollars,
  });
  const cardName = (card.card_name ?? "").trim() || "Untitled";
  const cardSet = (card.set_name ?? "").trim();
  const cardStatus = normalizeCardStatus(card.status);
  const subtotal =
    cardStatus === "canceled" ? 0 : servicesSubtotal + cardHv;
  const statusLabel =
    CARD_STATUSES.find((status) => status.id === cardStatus)?.label ?? cardStatus;
  const customerDamageTags = labeledDamageTags(card.damage_tags);
  const selectedDamageIds = new Set(customerDamageTags.map((tag) => tag.id));

  function renderQuoteServiceLine(item, index) {
    const hasService = quoteItemHasService(item);
    const serviceReady = quoteItemIsReady(item);
    const lineId = String(item.id ?? `quote-${index}`);
    const isExpanded = !serviceReady || String(expandedQuoteLineId) === lineId;
    const base = moneyFieldToPayload(item.quote_base_amount) ?? 0;
    const accent = serviceAccent(item.service_key);
    const serviceName =
      item.service_label?.trim() ||
      defaultServiceLabel(item.service_key) ||
      (item.service_key === SERVICE_KEYS.CUSTOM ? "Custom" : "Service");

    if (serviceReady && !isExpanded) {
      return (
        <div
          key={lineId}
          data-quote-line-id={lineId}
          className="flex items-center gap-1.5"
        >
          <button
            type="button"
            onClick={() => setExpandedQuoteLineId(lineId)}
            className={`flex min-w-0 flex-1 items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition ${serviceAccentChipClass(
              accent,
              true
            )}`}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${serviceAccentDotClass(
                  accent
                )}`}
                aria-hidden="true"
              />
              <span className="min-w-0 truncate text-sm font-semibold text-ink">
                {serviceName}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <span className="text-sm font-semibold tabular-nums text-ink/85">
                {formatMoney(base)}
              </span>
              <Chevron className="h-3.5 w-3.5 text-ink/30" />
            </span>
          </button>
          <RemoveButton
            label="Remove service"
            disabled={saving}
            onClick={() => removeQuoteItem(index)}
          />
        </div>
      );
    }

    return (
      <div
        key={lineId}
        data-quote-line-id={lineId}
        className={`space-y-2.5 rounded-lg border p-3 ${
          hasService
            ? serviceAccentPanelClass(accent)
            : "border-ink/15 bg-night/30"
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2 truncate font-mono text-[10px] uppercase tracking-[0.18em] text-ink/45">
            {hasService ? (
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${serviceAccentDotClass(
                  accent
                )}`}
                aria-hidden="true"
              />
            ) : null}
            <span className="truncate">
              {hasService ? serviceName : "New service"}
            </span>
          </span>
          <RemoveButton
            label="Remove service"
            disabled={saving}
            className="-mr-1.5 -mt-1 h-6 w-6"
            onClick={() => removeQuoteItem(index)}
          />
        </div>
        <div className="flex flex-wrap gap-2.5">
          <select
            className={`${editorFieldClass({ fullWidth: false })} min-w-[11rem] flex-1`}
            value={item.service_key || ""}
            disabled={saving}
            onChange={(event) => {
              applyServiceToQuoteItem(index, event.target.value);
              setExpandedQuoteLineId(lineId);
            }}
          >
            <option value="">Select a service…</option>
            {QUOTE_SERVICES.map((service) => (
              <option key={service.key} value={service.key}>
                {serviceSelectLabel(service)}
              </option>
            ))}
          </select>
          <input
            className={`${editorFieldClass({ fullWidth: false })} w-24 shrink-0`}
            inputMode="decimal"
            value={hasService ? item.quote_base_amount : ""}
            disabled={!hasService || saving}
            onChange={(event) =>
              updateQuoteItem(index, { quote_base_amount: event.target.value })
            }
            placeholder="$"
          />
        </div>
        {item.service_key === SERVICE_KEYS.CUSTOM ? (
          <input
            className={editorFieldClass()}
            value={item.service_label}
            disabled={saving}
            onChange={(event) =>
              updateQuoteItem(index, { service_label: event.target.value })
            }
            placeholder="Custom service name"
          />
        ) : null}
        {item.service_key === SERVICE_KEYS.WHITENING ? (
          <p
            className="rounded-lg border border-ink/25 bg-ink/10 px-3 py-2 text-xs leading-relaxed text-ink/75"
            role="note"
          >
            <span className="font-semibold text-ink">Note. </span>
            {CARD_WHITENING_WARNING}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <section
      className={`overflow-hidden rounded-2xl border transition ${
        expanded
          ? "border-ink/30 bg-ink/[0.03]"
          : "border-ink/10 bg-cream/40 hover:border-ink/25"
      }`}
    >
      <button
        type="button"
        onClick={() => onExpandedChange?.(!expanded)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 px-4 py-3 text-left sm:px-5"
      >
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-ink/10 text-[11px] font-bold tabular-nums text-ink/55">
          {cardIndex + 1}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate">
            <span className="text-sm font-semibold text-ink">{cardName}</span>
            {cardSet ? (
              <span className="text-sm text-ink/45"> · {cardSet}</span>
            ) : null}
          </span>
          {customerDamageTags.length > 0 ? (
            <span className="mt-1 flex flex-wrap gap-1">
              <DamageTagChips
                tags={customerDamageTags}
                className="rounded border border-ink/12 bg-ink/[0.04] px-1.5 py-0.5 text-[10px] font-semibold text-ink/70"
              />
            </span>
          ) : (
            <span className="mt-1 block text-[11px] font-medium text-ink/40">
              No damage tags
            </span>
          )}
        </span>
        {subtotal > 0 ? (
          <span className="hidden shrink-0 text-sm font-semibold tabular-nums text-ink/85 sm:block">
            {formatMoney(subtotal)}
          </span>
        ) : null}
        <span
          className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${cardStatusBadgeClass(
            cardStatus
          )}`}
        >
          {statusLabel}
        </span>
        <ExpandChevron open={expanded} className="h-4 w-4 text-ink/35" />
      </button>

      <ExpandPanel
        open={expanded}
        innerClassName="space-y-5 border-t border-ink/10 px-4 pb-4 pt-4 sm:px-5 sm:pb-5"
      >
          <FieldGrid>
            <label className="block">
              <EditorLabel>Card name</EditorLabel>
              <input
                className={editorFieldClass()}
                value={card.card_name}
                disabled={saving}
                onChange={(event) => updateCard({ card_name: event.target.value })}
              />
            </label>
            <label className="block">
              <EditorLabel>Set</EditorLabel>
              <input
                className={editorFieldClass()}
                value={card.set_name}
                disabled={saving}
                onChange={(event) => updateCard({ set_name: event.target.value })}
              />
            </label>
          </FieldGrid>

          <div>
            <EditorLabel>Damage</EditorLabel>
            <p className="mt-1 text-xs text-ink/50">
              Customer selection — you can add or remove tags.
            </p>
            <div
              className="mt-1.5 flex flex-wrap gap-1.5"
              role="group"
              aria-label="Damage types"
            >
              {DAMAGE_TAGS.map((tag) => {
                const selected = selectedDamageIds.has(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    disabled={saving}
                    aria-pressed={selected}
                    onClick={() => toggleDamageTag(tag.id)}
                    className={
                      selected
                        ? "rounded-md border border-ink/45 bg-ink/20 px-2.5 py-1 text-xs font-semibold text-ink ring-1 ring-ink/25 transition"
                        : "rounded-md border border-ink/15 bg-ink/[0.03] px-2.5 py-1 text-xs font-semibold text-ink/70 transition hover:border-ink/35 hover:bg-ink/10 hover:text-ink"
                    }
                  >
                    {tag.label}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="block">
            <EditorLabel>Description</EditorLabel>
            <textarea
              className={`${editorFieldClass()} min-h-[64px]`}
              value={card.description}
              disabled={saving}
              onChange={(event) => updateCard({ description: event.target.value })}
            />
          </label>

          <AdminNoteField
            label="Note from PokePatch"
            hint="Visible to customer on this card"
            value={card.admin_note}
            disabled={saving}
            onChange={(event) => updateCard({ admin_note: event.target.value })}
            placeholder="Optional note about this card…"
          />

          <div>
            <EditorLabel>Status</EditorLabel>
            <div className="flex flex-wrap gap-1.5">
              {CARD_STATUSES.map((status) => {
                const selected = cardStatus === status.id;
                return (
                  <button
                    key={status.id}
                    type="button"
                    disabled={saving}
                    onClick={() => updateCard({ status: status.id })}
                    aria-pressed={selected}
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold transition ${
                      selected
                        ? cardStatusBadgeClass(status.id)
                        : "bg-ink/5 text-ink/45 hover:bg-ink/10 hover:text-ink/70"
                    }`}
                  >
                    {status.label}
                  </button>
                );
              })}
            </div>
          </div>

          <EditorDivider label="Photos" />
          <div className="space-y-3">
            <AdminOrderCardPhotoGroups
              items={savedPhotoItems(card.images ?? [])}
              pendingFiles={pendingFiles}
              onRemove={
                removingPhotoId != null || saving ? undefined : removePhoto
              }
              onRemovePending={
                saving
                  ? undefined
                  : (fileId) =>
                      updateCard({
                        pending_files: pendingFiles.filter(
                          (entry) => entry.id !== fileId
                        ),
                      })
              }
            />
            {photoError ? (
              <p className="text-sm text-error">{photoError}</p>
            ) : null}
            <div>
              <input
                id={photoInputId}
                type="file"
                accept="image/*"
                multiple
                disabled={saving}
                onChange={(event) => {
                  addPendingFiles(event.target.files);
                  event.target.value = "";
                }}
                className="sr-only"
              />
              <label
                htmlFor={photoInputId}
                className={`inline-flex items-center rounded-lg border px-3 py-1.5 text-sm font-semibold transition ${
                  saving
                    ? "cursor-not-allowed border-ink/10 text-ink/35"
                    : "cursor-pointer border-ink/25 text-ink hover:bg-ink/10"
                }`}
              >
                Add photos
              </label>
            </div>
          </div>

          <EditorDivider label="Services" />
          <div className="space-y-2">
            {quoteItems.map((item, index) => renderQuoteServiceLine(item, index))}
            <GhostButton onClick={addQuoteItem} disabled={saving}>
              + Add service
            </GhostButton>
          </div>

          <div>
            <EditorLabel>High-value fee</EditorLabel>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <input
                className={`${editorFieldClass({ fullWidth: false })} w-40`}
                inputMode="decimal"
                value={card.market_value_raw_nm ?? ""}
                disabled={saving}
                onChange={(event) =>
                  updateCard({ market_value_raw_nm: event.target.value })
                }
                placeholder="Market value $"
              />
              {cardStatus !== "canceled" && cardHv > 0 ? (
                <span className="text-sm font-semibold tabular-nums text-peach">
                  +{formatMoney(cardHv)} fee
                </span>
              ) : null}
            </div>
            <p className="mt-1.5 text-[11px] text-ink/35">
              {HV_TIER_RANGES_LABEL}
            </p>
          </div>

          <div className="flex items-center justify-between border-t border-ink/10 pt-3">
            <GhostButton danger onClick={onRemoveCard} disabled={saving}>
              Remove card
            </GhostButton>
            <p className="text-right text-sm font-bold tabular-nums text-ink">
              {cardStatus === "canceled" ? (
                <span className="font-semibold text-ink/45">
                  Not in quote
                </span>
              ) : (
                <>Subtotal {formatMoney(subtotal)}</>
              )}
            </p>
          </div>
      </ExpandPanel>
    </section>
  );
}
