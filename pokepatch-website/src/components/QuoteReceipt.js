"use client";

import { useState } from "react";
import {
  buildQuoteReceiptPayload,
  formatMoney,
  quoteReceiptHasContent,
  receiptQueueFeeRows,
  receiptPsaReadyFeeRows,
} from "@/lib/servicePricing";
import { ExpandChevron, ExpandPanel } from "@/components/ExpandReveal";

function formatReceiptPercent(percent) {
  const n = Number(percent);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n % 1 === 0 ? String(n) : n.toFixed(2);
}

/**
 * Receipt-style quote summary:
 * per-card subsections with nested services + card-level HV (amount in header),
 * then order-level adjustments, total.
 *
 * Pass either live `items`/`cards`/`adjustments` (admin + My Orders) or a
 * stored `receipt` snapshot (email / message history).
 */
export default function QuoteReceipt({
  items = [],
  cards = null,
  adjustments = null,
  isPriority = false,
  queueSpeed = null,
  cardCount = null,
  receipt: receiptProp = null,
  title = "Quote total",
  className = "",
  collapsible = false,
  defaultOpen = true,
}) {
  const [open, setOpen] = useState(defaultOpen);
  const receipt = quoteReceiptHasContent(receiptProp)
    ? receiptProp
    : buildQuoteReceiptPayload({
        items,
        cards,
        adjustments,
        isPriority,
        queueSpeed,
        cardCount,
      });
  const bodyOpen = !collapsible || open;

  if (!quoteReceiptHasContent(receipt)) {
    return null;
  }

  const cardRows = receipt.cards ?? [];
  const adjustmentRows = receipt.adjustments ?? [];
  const queueFeeRows = receiptQueueFeeRows(receipt);
  const psaReadyFeeRows = receiptPsaReadyFeeRows(receipt);
  const total = receipt.total;

  const body = (
    <div className={`space-y-3 ${collapsible ? "mt-2" : ""}`}>
      {cardRows.map((card, groupIndex) => (
        <div
          key={card.label ? `${card.label}-${groupIndex}` : `card-${groupIndex}`}
          className="rounded-lg border border-ink/10 bg-cream/40 px-2.5 py-2"
        >
          <div className="flex items-start justify-between gap-3 font-sans">
            <span className="min-w-0 break-words text-sm font-semibold text-ink">
              {groupIndex > 0 ? (
                <span className="font-mono font-normal text-ink/45">+ </span>
              ) : null}
              {card.label}
            </span>
            <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">
              {formatMoney(card.subtotal)}
            </span>
          </div>

          {(card.lines ?? []).length > 0 || card.note ? (
            <div className="mt-1.5 space-y-1.5 border-t border-ink/10 pt-1.5 pl-2">
              {(card.lines ?? []).map((line, itemIndex) => (
                <div
                  key={`${card.label}-line-${itemIndex}`}
                  className="flex items-start justify-between gap-3"
                >
                  <span className="min-w-0 break-words text-ink/80">
                    {line.label}
                  </span>
                  <span className="shrink-0 tabular-nums font-semibold text-ink">
                    {formatMoney(line.amount)}
                  </span>
                </div>
              ))}
              {card.note ? (
                <p className="text-xs leading-relaxed text-ink/55">{card.note}</p>
              ) : null}
            </div>
          ) : null}
        </div>
      ))}

      {adjustmentRows.map((line, index) => {
        const percentLabel = formatReceiptPercent(line.amountPercent);
        return (
          <div
            key={line.description ? `${line.description}-${index}` : `adj-${index}`}
            className="flex items-start justify-between gap-3 text-ink/80"
          >
            <span className="min-w-0">
              <span className="text-ink/45">
                {line.amount >= 0 ? "+ " : "− "}
              </span>
              {line.description}
              {percentLabel ? (
                <span className="text-ink/45">{` (${percentLabel}%)`}</span>
              ) : null}
            </span>
            <span className="shrink-0 tabular-nums">
              {formatMoney(line.amount)}
            </span>
          </div>
        );
      })}

      {queueFeeRows.map((row) => (
        <div
          key={row.speed || row.description}
          className="flex items-start justify-between gap-3 text-ink/80"
        >
          <span className="min-w-0">
            <span className="text-ink/45">+ </span>
            {row.description}
          </span>
          <span className="shrink-0 tabular-nums">
            {formatMoney(row.amount)}
          </span>
        </div>
      ))}

      {psaReadyFeeRows.map((row) => (
        <div
          key={row.description}
          className="flex items-start justify-between gap-3 text-ink/80"
        >
          <span className="min-w-0">
            <span className="text-ink/45">+ </span>
            {row.description}
          </span>
          <span className="shrink-0 tabular-nums">
            {formatMoney(row.amount)}
          </span>
        </div>
      ))}

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
      className={`rounded-xl border border-ink/25 bg-ink/10 px-3 py-3 font-mono text-sm ${className}`}
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
