import {
  bulkDiscountLines,
  computeQuoteTotal,
  formatMoney,
  quoteItemCardLabel,
  quoteItemLineTotal,
} from "@/lib/servicePricing";

/**
 * Receipt-style quote summary:
 * card (set) line amounts, then bulk discounts, optional override, total.
 */
export default function QuoteReceipt({
  items = [],
  bulkCounts = null,
  overrideLabel = "",
  overrideAmount = null,
  title = "Quote total",
  className = "",
}) {
  const lines = items ?? [];
  const bulkLines = bulkDiscountLines(bulkCounts);
  const override =
    overrideAmount != null && Number.isFinite(Number(overrideAmount))
      ? Number(overrideAmount)
      : null;
  const total = computeQuoteTotal({
    items: lines,
    bulkCounts,
    overrideAmount: override,
  });

  if (
    lines.length === 0 &&
    bulkLines.length === 0 &&
    override == null
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
      <div className="space-y-2.5">
        {lines.map((item, index) => {
          const base = Number(item.quote_base_amount) || 0;
          const hv = Number(item.high_value_surcharge) || 0;
          const amount = quoteItemLineTotal(item);
          const service =
            (item.service_label || "").trim() || "Service";
          return (
            <div
              key={item.id ?? `receipt-line-${index}`}
              className="space-y-0.5"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0 text-ink/80">
                  {index > 0 ? (
                    <span className="text-ink/45">+ </span>
                  ) : null}
                  <span className="break-words">
                    {quoteItemCardLabel(item)}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums font-semibold text-ink">
                  {formatMoney(amount)}
                </span>
              </div>
              <div className="pl-3 text-xs text-ink/55">
                <p>{service}</p>
                <p className="tabular-nums">
                  base {formatMoney(base)}
                  {hv !== 0 ? (
                    <> + surcharge {formatMoney(hv)}</>
                  ) : null}
                </p>
              </div>
            </div>
          );
        })}

        {bulkLines.map((line) => (
          <div
            key={line.serviceKey}
            className="flex items-start justify-between gap-3 text-ink/80"
          >
            <span className="min-w-0">
              <span className="text-ink/45">− </span>
              {line.label} bulk ({line.count} × ${Number(line.perCardOff).toFixed(2)}/card)
            </span>
            <span className="shrink-0 tabular-nums">
              −{formatMoney(line.totalOff)}
            </span>
          </div>
        ))}

        {override != null && overrideLabel ? (
          <div className="flex items-start justify-between gap-3 text-ink/80">
            <span className="min-w-0">
              <span className="text-ink/45">
                {override >= 0 ? "+ " : "− "}
              </span>
              {overrideLabel}
            </span>
            <span className="shrink-0 tabular-nums">
              {formatMoney(override)}
            </span>
          </div>
        ) : null}

        <div className="mt-2 flex items-center justify-between gap-3 border-t border-dashed border-ink/20 pt-2 font-sans">
          <span className="font-semibold text-ink">= Total</span>
          <span className="text-base font-bold tabular-nums text-ink">
            {formatMoney(total)}
          </span>
        </div>
      </div>
    </div>
  );
}
