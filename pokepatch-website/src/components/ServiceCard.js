export default function ServiceCard({
  title,
  price,
  unit,
  priceStacked = false,
  priceNote = null,
  features = [],
  featuresLabel = null,
  warning = null,
  bulk = [],
  bulkLabel = "Bulk Pricing",
}) {
  return (
    <div className="flex h-full flex-col marketing-panel p-4 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-lg font-medium tracking-tight text-ink">{title}</h3>
        {price && (
          <div
            className={`flex shrink-0 rounded-lg bg-ink/5 px-3 py-2 text-right ring-1 ring-ink/10 ${
              priceStacked
                ? "flex-col items-end gap-0.5"
                : "items-baseline gap-1"
            }`}
          >
            <span className="font-mono text-xl leading-none text-ink">
              {price}
            </span>
            {unit && (
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink/50">
                {unit}
              </span>
            )}
            {priceNote ? (
              <span className="font-mono text-[9px] uppercase leading-tight tracking-[0.1em] text-ink/40">
                {priceNote}
              </span>
            ) : null}
          </div>
        )}
      </div>

      {features.length > 0 && (
        <div className="mt-4">
          {featuresLabel ? (
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/45">
              {featuresLabel}
            </p>
          ) : null}
          <ul
            className={`space-y-1 text-sm text-ink/60 ${
              featuresLabel ? "mt-2" : ""
            }`}
          >
            {features.map((feature) => (
              <li key={feature} className="flex items-start gap-2">
                <span className="text-ink/35">—</span>
                {feature}
              </li>
            ))}
          </ul>
        </div>
      )}

      {warning ? (
        <p className="mt-4 border-t border-ink/10 pt-3 text-sm leading-relaxed text-ink/70">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink">
            Note
          </span>
          <span className="mt-1.5 block">{warning}</span>
        </p>
      ) : null}

      {bulk.length > 0 && (
        <div className="mt-4 border-t border-ink/10 pt-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/45">
            {bulkLabel}
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {bulk.map((item) => (
              <li
                key={item.label}
                className="flex items-center justify-between gap-3"
              >
                <span className="text-ink/60">{item.label}</span>
                <span className="font-mono tabular-nums text-ink">
                  {item.value}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
