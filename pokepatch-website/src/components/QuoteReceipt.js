"use client";

import { useState } from "react";
import {
  billableQuoteCards,
  billableQuoteItems,
  computeQuoteTotal,
  formatMoney,
  groupQuoteItemsByCard,
  hasPriorityAdjustment,
  priorityServiceDescription,
  priorityServiceFee,
  quoteAdjustmentLines,
  quoteItemLineTotal,
} from "@/lib/servicePricing";
import { ExpandChevron, ExpandPanel } from "@/components/ExpandReveal";

/**
 * Receipt-style quote summary:
 * per-card subsections with nested services + card-level HV (amount in header),
 * then order-level adjustments, total.
 */
export default function QuoteReceipt({
  items = [],
  cards = null,
  adjustments = null,
  isPriority = false,
  cardCount = null,
  title = "Quote total",
  className = "",
  collapsible = false,
  defaultOpen = true,
}) {
  const [open, setOpen] = useState(defaultOpen);
  const lines = billableQuoteItems(items, cards);
  const cardGroups = groupQuoteItemsByCard(items, cards);
  const adjustmentLines = quoteAdjustmentLines(adjustments, lines);
  const resolvedCardCount =
    Array.isArray(cards) && cards.length > 0
      ? billableQuoteCards(cards).length
      : cardCount ?? null;
  const showComputedPriorityLine =
    isPriority &&
    resolvedCardCount != null &&
    !hasPriorityAdjustment(adjustments);
  const priorityFee = showComputedPriorityLine
    ? priorityServiceFee(resolvedCardCount)
    : 0;
  const total = computeQuoteTotal({
    items,
    cards,
    adjustments,
    isPriority,
    cardCount: resolvedCardCount,
  });
  const bodyOpen = !collapsible || open;

  if (
    lines.length === 0 &&
    cardGroups.length === 0 &&
    adjustmentLines.length === 0 &&
    priorityFee <= 0
  ) {
    return null;
  }

  const body = (
    <div className={`space-y-3 ${collapsible ? "mt-2" : ""}`}>
      {cardGroups.map((group, groupIndex) => (
        <div
          key={group.key || `card-group-${groupIndex}`}
          className="rounded-lg border border-ink/10 bg-cream/40 px-2.5 py-2"
        >
          <div className="flex items-start justify-between gap-3 font-sans">
            <span className="min-w-0 break-words text-sm font-semibold text-ink">
              {groupIndex > 0 ? (
                <span className="font-mono font-normal text-ink/45">+ </span>
              ) : null}
              {group.label}
            </span>
            <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">
              {formatMoney(group.subtotal)}
            </span>
          </div>

          <div className="mt-1.5 space-y-1.5 border-t border-ink/10 pt-1.5 pl-2">
            {group.items.map((item, itemIndex) => {
              const amount = quoteItemLineTotal(item);
              const service =
                (item.service_label || "").trim() || "Service";
              return (
                <div
                  key={item.id ?? `${group.key}-svc-${itemIndex}`}
                  className="flex items-start justify-between gap-3"
                >
                  <span className="min-w-0 break-words text-ink/80">
                    {service}
                  </span>
                  <span className="shrink-0 tabular-nums font-semibold text-ink">
                    {formatMoney(amount)}
                  </span>
                </div>
              );
            })}

            {group.highValueSurcharge > 0 ? (
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0 break-words text-ink/80">
                  High-value fee
                </span>
                <span className="shrink-0 tabular-nums font-semibold text-ink">
                  {formatMoney(group.highValueSurcharge)}
                </span>
              </div>
            ) : null}
          </div>
        </div>
      ))}

      {adjustmentLines.map((line) => (
        <div
          key={line.id}
          className="flex items-start justify-between gap-3 text-ink/80"
        >
          <span className="min-w-0">
            <span className="text-ink/45">
              {line.amount >= 0 ? "+ " : "− "}
            </span>
            {line.description}
            {line.amountPercent != null && line.amountPercent > 0 ? (
              <span className="text-ink/45">
                {" "}
                ({Number(line.amountPercent).toFixed(
                  Number(line.amountPercent) % 1 === 0 ? 0 : 2
                )}
                %)
              </span>
            ) : null}
          </span>
          <span className="shrink-0 tabular-nums">
            {formatMoney(line.amount)}
          </span>
        </div>
      ))}

      {priorityFee > 0 ? (
        <div className="flex items-start justify-between gap-3 text-ink/80">
          <span className="min-w-0">
            <span className="text-ink/45">+ </span>
            {priorityServiceDescription(resolvedCardCount)}
          </span>
          <span className="shrink-0 tabular-nums">{formatMoney(priorityFee)}</span>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3 border-t border-dashed border-ink/20 pt-2 font-sans">
        <span className="font-semibold text-ink">= Total</span>
        <span className="text-base font-bold tabular-nums text-ink">
          {formatMoney(total)}
        </span>
      </div>
    </div>
  );

  return (
    <div
      className={`rounded-xl border border-berry/25 bg-berry/10 px-3 py-3 font-mono text-sm ${className}`}
    >
      {collapsible ? (
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          className="flex w-full items-center gap-3 text-left"
        >
          <span className="min-w-0 flex-1 font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-ink/55">
            {title}
          </span>
          {!open ? (
            <span className="shrink-0 font-sans text-sm font-bold tabular-nums text-ink">
              {formatMoney(total)}
            </span>
          ) : null}
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-night/40 text-ink/60">
            <ExpandChevron open={open} />
          </span>
        </button>
      ) : (
        <p className="mb-2 font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-ink/55">
          {title}
        </p>
      )}
      {collapsible ? (
        <ExpandPanel open={bodyOpen}>
          {body}
        </ExpandPanel>
      ) : (
        body
      )}
    </div>
  );
}
