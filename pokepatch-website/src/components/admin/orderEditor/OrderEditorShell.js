"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  orderDisplayLabel,
  orderStatusBadgeClass,
} from "@/lib/orderStatus";
import {
  emptyAdminCard,
  emptyQuoteItem,
  ensureQuoteItemsForCards,
  quoteItemBelongsToCard,
} from "@/lib/adminOrderDraft";
import { computeQuoteTotal, formatMoney } from "@/lib/servicePricing";
import OrderNoteOnlyDialog from "@/components/admin/OrderNoteOnlyDialog";
import OrderSaveChangesDialog from "@/components/admin/OrderSaveChangesDialog";
import { buildCardThumbById } from "@/lib/orderChangelog";
import {
  OrderEditorProvider,
  useOrderEditor,
} from "@/components/admin/orderEditor/OrderEditorContext";
import {
  CustomerPanel,
  OrderPanel,
} from "@/components/admin/orderEditor/OrderEditorSidebar";
import CardDetailSection from "@/components/admin/orderEditor/sections/CardDetailSection";
import QuoteSection, {
  buildQuotePreview,
} from "@/components/admin/orderEditor/sections/QuoteSection";

function scrollToCard(cardId) {
  if (!cardId) return;
  document.getElementById(`card-${cardId}`)?.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}

function OrderEditorContent({
  displayId,
  onBack,
  backLabel,
  onError,
  externalError,
  onSendMessage,
  noteOnlySending,
}) {
  const searchParams = useSearchParams();
  const [noteOnlyOpen, setNoteOnlyOpen] = useState(false);
  // undefined = follow the URL / default; null = all collapsed.
  const [manualExpandId, setManualExpandId] = useState(undefined);

  const {
    draft,
    updateDraft,
    dirty,
    saving,
    error,
    discardChanges,
    requestSave,
    performSave,
    savePromptOpen,
    setSavePromptOpen,
    beforePayload,
    afterPayload,
  } = useOrderEditor();

  const cards = draft.cards ?? [];
  const scrollCardId = searchParams.get("card");
  const errorMessage = error || externalError || "";

  useEffect(() => {
    setManualExpandId(undefined);
  }, [scrollCardId]);

  const autoExpandId =
    scrollCardId != null
      ? String(scrollCardId)
      : cards.length > 0
        ? String(cards[0].id)
        : null;
  const expandedCardId =
    manualExpandId === undefined ? autoExpandId : manualExpandId;

  const preview = buildQuotePreview(draft);
  const total = computeQuoteTotal({
    items: preview.items,
    cards: preview.cards,
    adjustments: preview.adjustments,
    isPriority: Boolean(draft.is_priority),
    cardCount: (draft.cards ?? []).length,
  });

  useEffect(() => {
    if (scrollCardId) scrollToCard(scrollCardId);
  }, [scrollCardId]);

  // Cmd/Ctrl+S saves the order instead of the page.
  useEffect(() => {
    function onKeyDown(event) {
      if ((event.metaKey || event.ctrlKey) && event.key === "s") {
        event.preventDefault();
        if (dirty && !saving) requestSave();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dirty, saving, requestSave]);

  function handleAddCard() {
    onError?.("");
    const card = emptyAdminCard();
    card.card_name = "New card";
    updateDraft((base) => ({
      ...base,
      cards: [...base.cards, card],
      quote_items: ensureQuoteItemsForCards(
        [...base.cards, card],
        [...base.quote_items, emptyQuoteItem(card)]
      ),
    }));
    setManualExpandId(String(card.id));
    requestAnimationFrame(() => scrollToCard(card.id));
  }

  function handleRemoveCard(cardId) {
    if (!window.confirm("Remove this card from the order?")) return;
    onError?.("");
    updateDraft((base) => {
      const id = String(cardId);
      const removed = base.cards.find((c) => String(c.id) === id);
      if (!removed) return base;
      const cardsNext = base.cards.filter((c) => String(c.id) !== id);
      const quote_items = base.quote_items.filter(
        (item) => !quoteItemBelongsToCard(item, removed, base.cards)
      );
      const quote_card_hv = { ...base.quote_card_hv };
      delete quote_card_hv[id];
      return { ...base, cards: cardsNext, quote_items, quote_card_hv };
    });
    if (String(expandedCardId) === String(cardId)) {
      setManualExpandId(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      {/* Sticky action bar, pinned just below the floating site navbar. */}
      <div className="sticky top-20 z-40 sm:top-24 mb-4 rounded-2xl border border-ink/10 bg-[#0a0714]/90 px-4 py-3 backdrop-blur sm:px-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <button
            type="button"
            onClick={onBack}
            className="shrink-0 font-mono text-[11px] uppercase tracking-[0.16em] text-ink/50 transition hover:text-ink"
          >
            ← {backLabel}
          </button>
          <div className="hidden h-5 w-px bg-ink/15 sm:block" aria-hidden="true" />
          <h1 className="text-base font-medium tabular-nums tracking-tight text-ink sm:text-lg">
            Order #{displayId}
          </h1>
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${orderStatusBadgeClass(
              draft.status,
              draft.pending_kind
            )}`}
          >
            {orderDisplayLabel(draft.status, draft.pending_kind)}
          </span>
          {dirty ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-ink/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink">
              <span
                className="h-1 w-1 rounded-full bg-ink"
                aria-hidden="true"
              />
              Unsaved
            </span>
          ) : null}

          <div className="ml-auto flex items-center gap-2">
            <div className="mr-1 hidden text-right leading-tight sm:block">
              <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink/40">
                Total
              </p>
              <p className="text-sm font-bold tabular-nums text-ink">
                {formatMoney(total)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setNoteOnlyOpen(true)}
              disabled={!draft.customer_email?.trim() || noteOnlySending}
              className="rounded-lg border border-ink/15 px-3 py-2 text-sm font-semibold text-ink/80 transition hover:border-ink/30 hover:text-ink disabled:opacity-40"
            >
              Message
            </button>
            {dirty ? (
              <button
                type="button"
                onClick={discardChanges}
                disabled={saving}
                className="rounded-lg border border-ink/15 px-3 py-2 text-sm font-semibold text-ink/80 transition hover:border-ink/50 hover:text-ink disabled:opacity-40"
              >
                Discard
              </button>
            ) : null}
            <button
              type="button"
              onClick={requestSave}
              disabled={saving || !dirty}
              className="rounded-lg bg-ink px-4 py-2 text-sm font-bold text-night transition hover:brightness-110 disabled:opacity-40 disabled:shadow-none"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        {errorMessage ? (
          <p className="mt-2.5 rounded-lg border border-error/35 bg-error/10 px-3 py-2 text-sm text-error">
            {errorMessage}
          </p>
        ) : null}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_330px]">
        <main className="min-w-0 space-y-4">
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-3 px-1">
              <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-ink/45">
                Cards · {cards.length}
              </h2>
              <button
                type="button"
                onClick={handleAddCard}
                disabled={saving}
                className="rounded-lg border border-ink/25 px-3 py-1.5 text-xs font-semibold text-ink transition hover:bg-ink/10 disabled:opacity-40"
              >
                + Add card
              </button>
            </div>

            {cards.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-ink/15 px-4 py-10 text-center">
                <p className="text-sm text-ink/45">No cards on this order yet.</p>
                <button
                  type="button"
                  onClick={handleAddCard}
                  disabled={saving}
                  className="mt-3 text-sm font-semibold text-ink transition hover:text-ink disabled:opacity-40"
                >
                  Add the first card
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {cards.map((card, index) => (
                  <div
                    key={card.id}
                    id={`card-${card.id}`}
                    className="scroll-mt-44"
                  >
                    <CardDetailSection
                      cardId={String(card.id)}
                      cardIndex={index}
                      expanded={expandedCardId === String(card.id)}
                      onExpandedChange={(open) =>
                        setManualExpandId(open ? String(card.id) : null)
                      }
                      onRemoveCard={() => handleRemoveCard(card.id)}
                    />
                  </div>
                ))}
              </div>
            )}
          </section>

          <QuoteSection />
        </main>

        <aside className="space-y-4">
          <CustomerPanel />
          <OrderPanel />
        </aside>
      </div>

      <OrderSaveChangesDialog
        open={savePromptOpen}
        variant="save"
        displayId={displayId}
        customerEmail={draft.customer_email}
        thumbByCardId={buildCardThumbById(draft.cards ?? [])}
        beforePayload={beforePayload}
        afterPayload={afterPayload}
        saving={saving}
        onCancel={() => {
          if (!saving) setSavePromptOpen(false);
        }}
        onConfirm={async (opts) => {
          const result = await performSave(opts);
          if (result.ok && result.notifyError) {
            onError?.(result.notifyError);
          }
        }}
      />

      <OrderNoteOnlyDialog
        open={noteOnlyOpen}
        displayId={displayId}
        customerEmail={draft.customer_email}
        sending={noteOnlySending}
        onCancel={() => {
          if (!noteOnlySending) setNoteOnlyOpen(false);
        }}
        onSend={async (payload) => {
          try {
            await onSendMessage?.(payload);
            setNoteOnlyOpen(false);
          } catch {
            // Error surfaced via onError in parent.
          }
        }}
      />
    </div>
  );
}

export default function OrderEditorShell(props) {
  return (
    <OrderEditorProvider
      key={props.orderId}
      order={props.order}
      orderId={props.orderId}
      onOrderUpdated={props.onOrderUpdated}
      onDirtyChange={props.onDirtyChange}
    >
      <OrderEditorContent
        displayId={props.displayId}
        onBack={props.onBack}
        backLabel={props.backLabel ?? "Back"}
        onError={props.onError}
        externalError={props.externalError}
        onSendMessage={props.onSendMessage}
        noteOnlySending={props.noteOnlySending ?? false}
      />
    </OrderEditorProvider>
  );
}
