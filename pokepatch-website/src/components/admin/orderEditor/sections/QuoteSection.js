"use client";

import QuoteReceipt from "@/components/QuoteReceipt";
import {
  ADJUSTMENT_KIND_OPTIONS,
  bulkDiscountPercentForCardCount,
  BULK_TIER_RANGES_LABEL,
  cardsWithQuoteHv,
  emptyQuoteAdjustment,
} from "@/lib/servicePricing";
import { moneyFieldToPayload, quoteItemIsReady } from "@/lib/adminOrderDraft";
import { useOrderEditor } from "@/components/admin/orderEditor/OrderEditorContext";
import {
  GhostButton,
  Panel,
  RemoveButton,
  editorFieldClass,
} from "@/components/admin/orderEditor/editorUi";

/** Receipt-ready items/cards/adjustments computed live from the draft. */
export function buildQuotePreview(draft) {
  const items = (draft.quote_items ?? [])
    .filter(quoteItemIsReady)
    .map((item) => ({
      id: item.id,
      card_name: item.card_name,
      set_name: item.set_name,
      service_label: item.service_label,
      quote_base_amount: moneyFieldToPayload(item.quote_base_amount) ?? 0,
    }));
  const cards = cardsWithQuoteHv(
    (draft.cards ?? []).map((card) => ({
      id: card.id,
      card_name: card.card_name,
      set_name: card.set_name,
    })),
    draft.quote_card_hv ?? {}
  );
  return {
    items,
    cards,
    adjustments: draft.quote_adjustments ?? [],
    cardCount: (draft.cards ?? []).length,
  };
}

export default function QuoteSection() {
  const { draft, updateDraft, saving } = useOrderEditor();
  const adjustments = draft.quote_adjustments ?? [];
  const preview = buildQuotePreview(draft);
  const bulkPercent = bulkDiscountPercentForCardCount(preview.cardCount);
  const hasReceipt =
    preview.items.length > 0 ||
    preview.cards.some((card) => card.hv_amount) ||
    adjustments.length > 0;

  function updateAdjustment(index, patch) {
    updateDraft((current) => ({
      ...current,
      quote_adjustments: current.quote_adjustments.map((row, i) =>
        i === index ? { ...row, ...patch } : row
      ),
    }));
  }

  function addAdjustment() {
    updateDraft((current) => ({
      ...current,
      quote_adjustments: [
        ...current.quote_adjustments,
        emptyQuoteAdjustment("discount"),
      ],
    }));
  }

  function removeAdjustment(index) {
    updateDraft((current) => ({
      ...current,
      quote_adjustments: current.quote_adjustments.filter((_, i) => i !== index),
    }));
  }

  return (
    <Panel
      title="Quote"
      action={
        <GhostButton onClick={addAdjustment} disabled={saving} className="text-xs">
          Add adjustment
        </GhostButton>
      }
    >
      <div className="space-y-4">
        {bulkPercent > 0 ? (
          <p className="rounded-lg border border-mint/25 bg-mint/10 px-3 py-2 text-xs leading-relaxed text-ink/70">
            {preview.cardCount} cards qualify for a {bulkPercent}% bulk discount
            ({BULK_TIER_RANGES_LABEL}).
          </p>
        ) : null}

        {adjustments.length > 0 ? (
          <div className="space-y-2">
            {adjustments.map((row, index) => (
              <div
                key={row.id ?? `adj-${index}`}
                className="flex flex-wrap items-center gap-2"
              >
                <select
                  className={`${editorFieldClass({ fullWidth: false })} w-28 shrink-0 px-2`}
                  value={row.kind || "discount"}
                  disabled={saving}
                  onChange={(event) =>
                    updateAdjustment(index, { kind: event.target.value })
                  }
                >
                  {ADJUSTMENT_KIND_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                  {row.kind === "surcharge" ? (
                    <option value="surcharge">Surcharge</option>
                  ) : null}
                </select>
                <input
                  className={`${editorFieldClass({ fullWidth: false })} w-24 shrink-0`}
                  inputMode="decimal"
                  value={row.amount_dollars ?? ""}
                  disabled={saving}
                  onChange={(event) =>
                    updateAdjustment(index, {
                      amount_dollars: event.target.value,
                      amount_percent: "",
                    })
                  }
                  placeholder="$"
                />
                <input
                  className={`${editorFieldClass({ fullWidth: false })} min-w-[9rem] flex-1`}
                  value={row.description ?? ""}
                  disabled={saving}
                  onChange={(event) =>
                    updateAdjustment(index, { description: event.target.value })
                  }
                  placeholder="Description (shown on receipt)"
                />
                <RemoveButton
                  label="Remove adjustment"
                  disabled={saving}
                  onClick={() => removeAdjustment(index)}
                />
              </div>
            ))}
          </div>
        ) : null}

        {hasReceipt || draft.is_priority ? (
          <QuoteReceipt
            items={preview.items}
            cards={preview.cards}
            adjustments={adjustments}
            isPriority={Boolean(draft.is_priority)}
            cardCount={(draft.cards ?? []).length}
            title="Receipt"
            className={
              draft.is_priority ? "border-berry/25 bg-berry/[0.07]" : ""
            }
          />
        ) : (
          <p className="text-sm text-ink/40">
            Add services on cards or an adjustment to build the quote.
          </p>
        )}
      </div>
    </Panel>
  );
}
