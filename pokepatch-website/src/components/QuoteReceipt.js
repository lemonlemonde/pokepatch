import {
  computeQuoteTotal,
  formatMoney,
  groupQuoteItemsByCard,
  quoteAdjustmentLines,
  quoteItemLineTotal,
} from "@/lib/servicePricing";

/**
 * Receipt-style quote summary:
 * per-card subsections with nested services + card-level HV + card subtotal,
 * then order-level adjustments, total.
 */
export default function QuoteReceipt({
  items = [],
  cards = null,
  adjustments = null,
  title = "Quote total",
  className = "",
}) {
  const lines = items ?? [];
  const cardGroups = groupQuoteItemsByCard(lines, cards);
  const adjustmentLines = quoteAdjustmentLines(adjustments, lines);
  const total = computeQuoteTotal({
    items: lines,
    cards,
    adjustments,
  });

  if (
    lines.length === 0 &&
    cardGroups.length === 0 &&
    adjustmentLines.length === 0
  ) {
    return null;
  }

  return (
    <div
      className={`rounded-xl border border-berry/25 bg-berry/10 px-3 py-3 font-mono text-sm ${className}`}
    >
      <p className="mb-2 font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-ink/55">
        {title}
      </p>
      <div className="space-y-3">
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
                <div className="space-y-0.5">
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0 break-words text-ink/80">
                      High-value surcharge
                    </span>
                    <span className="shrink-0 tabular-nums font-semibold text-ink">
                      {formatMoney(group.highValueSurcharge)}
                    </span>
                  </div>
                  <p className="text-xs tabular-nums text-ink/45">
                    {Number.isFinite(group.marketValue)
                      ? `market ${formatMoney(group.marketValue)}`
                      : "market —"}
                    {group.hvPercent != null &&
                    Number.isFinite(Number(group.hvPercent))
                      ? ` · ${Number(group.hvPercent)}%`
                      : null}
                  </p>
                </div>
              ) : null}

              <div className="flex items-center justify-between gap-3 border-t border-dashed border-ink/15 pt-1.5 font-sans text-xs">
                <span className="font-medium text-ink/55">Card subtotal</span>
                <span className="font-semibold tabular-nums text-ink">
                  {formatMoney(group.subtotal)}
                </span>
              </div>
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

        <div className="flex items-center justify-between gap-3 border-t border-dashed border-ink/20 pt-2 font-sans">
          <span className="font-semibold text-ink">= Total</span>
          <span className="text-base font-bold tabular-nums text-ink">
            {formatMoney(total)}
          </span>
        </div>
      </div>
    </div>
  );
}
