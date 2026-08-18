"use client";

import QuoteReceipt from "@/components/QuoteReceipt";
import {
  adminLedgerTotal,
  billableQuoteCards,
  bulkDiscountPercentForCardCount,
  BULK_TIER_RANGES_LABEL,
  cardsWithQuoteHv,
  emptyAdminLedgerEntry,
  emptyQuoteAdjustment,
  formatMoney,
  isPriorityAdjustmentRow,
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
      card_pick: item.card_pick,
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
      status: card.status,
    })),
    draft.quote_card_hv ?? {}
  );
  return {
    items,
    cards,
    adjustments: draft.quote_adjustments ?? [],
    cardCount: billableQuoteCards(draft.cards).length,
  };
}

function LedgerRowsEditor({
  rows,
  onChange,
  onRemove,
  saving,
  amountPlaceholder,
  descriptionPlaceholder,
  removeLabel,
}) {
  if (rows.length === 0) return null;
  return (
    <div className="space-y-2">
      {rows.map((row, index) => (
        <div
          key={row.id ?? `ledger-${index}`}
          className="flex flex-wrap items-center gap-2"
        >
          <input
            className={`${editorFieldClass({ fullWidth: false })} w-28 shrink-0`}
            inputMode="decimal"
            value={row.amount_dollars ?? ""}
            disabled={saving}
            onChange={(event) =>
              onChange(index, { amount_dollars: event.target.value })
            }
            placeholder={amountPlaceholder}
          />
          <input
            className={`${editorFieldClass({ fullWidth: false })} min-w-[9rem] flex-1`}
            value={row.description ?? ""}
            disabled={saving}
            onChange={(event) =>
              onChange(index, { description: event.target.value })
            }
            placeholder={descriptionPlaceholder}
          />
          <RemoveButton
            label={removeLabel}
            disabled={saving}
            onClick={() => onRemove(index)}
          />
        </div>
      ))}
    </div>
  );
}

export default function QuoteSection() {
  const { draft, updateDraft, saving } = useOrderEditor();
  const adjustments = draft.quote_adjustments ?? [];
  const editableAdjustments = adjustments.filter(
    (row) => !isPriorityAdjustmentRow(row)
  );
  const adminTips = draft.admin_tips ?? [];
  const restorationCosts = draft.restoration_costs ?? [];
  const preview = buildQuotePreview(draft);
  const bulkPercent = bulkDiscountPercentForCardCount(preview.cardCount);
  const hasReceipt =
    preview.items.length > 0 ||
    preview.cards.some((card) => card.hv_amount) ||
    adjustments.length > 0;
  const tipsTotal = adminLedgerTotal(adminTips);
  const costsTotal = adminLedgerTotal(restorationCosts);

  /** Keep auto-synced priority surcharge rows intact when editing manual ones. */
  function mapEditableAdjustments(mapper) {
    updateDraft((current) => {
      const all = current.quote_adjustments ?? [];
      const editable = all.filter((row) => !isPriorityAdjustmentRow(row));
      const priorityRows = all.filter(isPriorityAdjustmentRow);
      return {
        ...current,
        quote_adjustments: [...mapper(editable), ...priorityRows],
      };
    });
  }

  function updateAdjustment(index, patch) {
    mapEditableAdjustments((editable) =>
      editable.map((row, i) =>
        i === index ? { ...row, ...patch, kind: "adjustment" } : row
      )
    );
  }

  function addAdjustment() {
    mapEditableAdjustments((editable) => [
      ...editable,
      emptyQuoteAdjustment("adjustment"),
    ]);
  }

  function removeAdjustment(index) {
    mapEditableAdjustments((editable) =>
      editable.filter((_, i) => i !== index)
    );
  }

  function mapLedger(field, mapper) {
    updateDraft((current) => ({
      ...current,
      [field]: mapper(current[field] ?? []),
    }));
  }

  function updateTip(index, patch) {
    mapLedger("admin_tips", (rows) =>
      rows.map((row, i) => (i === index ? { ...row, ...patch } : row))
    );
  }

  function addTip() {
    mapLedger("admin_tips", (rows) => [...rows, emptyAdminLedgerEntry()]);
  }

  function removeTip(index) {
    mapLedger("admin_tips", (rows) => rows.filter((_, i) => i !== index));
  }

  function updateCost(index, patch) {
    mapLedger("restoration_costs", (rows) =>
      rows.map((row, i) => (i === index ? { ...row, ...patch } : row))
    );
  }

  function addCost() {
    mapLedger("restoration_costs", (rows) => [
      ...rows,
      emptyAdminLedgerEntry(),
    ]);
  }

  function removeCost(index) {
    mapLedger("restoration_costs", (rows) =>
      rows.filter((_, i) => i !== index)
    );
  }

  return (
    <>
      <Panel
        title="Adjustments"
        action={
          <GhostButton
            onClick={addAdjustment}
            disabled={saving}
            className="text-xs"
          >
            Add adjustment
          </GhostButton>
        }
      >
        {editableAdjustments.length > 0 ? (
          <div className="space-y-2">
            {editableAdjustments.map((row, index) => (
              <div
                key={row.id ?? `adj-${index}`}
                className="flex flex-wrap items-center gap-2"
              >
                <input
                  className={`${editorFieldClass({ fullWidth: false })} w-28 shrink-0`}
                  inputMode="decimal"
                  value={row.amount_dollars ?? ""}
                  disabled={saving}
                  onChange={(event) =>
                    updateAdjustment(index, {
                      amount_dollars: event.target.value,
                      amount_percent: "",
                    })
                  }
                  placeholder="+/− $"
                />
                <input
                  className={`${editorFieldClass({ fullWidth: false })} min-w-[9rem] flex-1`}
                  value={row.description ?? ""}
                  disabled={saving}
                  onChange={(event) =>
                    updateAdjustment(index, {
                      description: event.target.value,
                    })
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
      </Panel>

      <Panel
        title="Tips"
        action={
          <GhostButton onClick={addTip} disabled={saving} className="text-xs">
            Add tip
          </GhostButton>
        }
      >
        <p className="mb-2 text-xs text-ink/45">
          Admin only — after restoration. Does not change the quote; adds to
          earned.
        </p>
        <LedgerRowsEditor
          rows={adminTips}
          onChange={updateTip}
          onRemove={removeTip}
          saving={saving}
          amountPlaceholder="$"
          descriptionPlaceholder="Description (admin only)"
          removeLabel="Remove tip"
        />
        {adminTips.length > 0 && tipsTotal !== 0 ? (
          <p className="mt-2 text-xs tabular-nums text-ink/55">
            Tips total {formatMoney(tipsTotal)}
          </p>
        ) : null}
      </Panel>

      <Panel
        title="Restoration spend"
        action={
          <GhostButton onClick={addCost} disabled={saving} className="text-xs">
            Add spend
          </GhostButton>
        }
      >
        <p className="mb-2 text-xs text-ink/45">
          Admin only — materials or costs during restoration. Does not change
          the quote; subtracts from earned.
        </p>
        <LedgerRowsEditor
          rows={restorationCosts}
          onChange={updateCost}
          onRemove={removeCost}
          saving={saving}
          amountPlaceholder="$"
          descriptionPlaceholder="Description (admin only)"
          removeLabel="Remove spend"
        />
        {restorationCosts.length > 0 && costsTotal !== 0 ? (
          <p className="mt-2 text-xs tabular-nums text-ink/55">
            Spend total {formatMoney(costsTotal)}
          </p>
        ) : null}
      </Panel>

      <Panel title="Quote">
        <div className="space-y-4">
          {bulkPercent > 0 ? (
            <p className="rounded-lg border border-mint/25 bg-mint/10 px-3 py-2 text-xs leading-relaxed text-ink/70">
              {preview.cardCount} cards qualify for a {bulkPercent}% bulk
              discount ({BULK_TIER_RANGES_LABEL}).
            </p>
          ) : null}

          {hasReceipt || draft.is_priority ? (
            <QuoteReceipt
              items={preview.items}
              cards={preview.cards}
              adjustments={adjustments}
              isPriority={Boolean(draft.is_priority)}
              cardCount={preview.cardCount}
              title="Receipt"
              className={
                draft.is_priority ? "border-ink/25 bg-ink/[0.07]" : ""
              }
            />
          ) : (
            <p className="text-sm text-ink/40">
              Add services on cards to build the quote.
            </p>
          )}
        </div>
      </Panel>
    </>
  );
}
