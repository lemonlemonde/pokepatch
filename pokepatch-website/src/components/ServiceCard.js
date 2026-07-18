export default function ServiceCard({
  title,
  price,
  unit,
  priceStacked = false,
  features = [],
  bulk = [],
  bulkLabel = "Bulk Pricing",
  accent,
}) {
  const accents = {
    blush: "bg-blush/30 border-blush/10",
    mint: "bg-mint/30 border-mint/10",
    lavender: "bg-lavender/30 border-lavender/10",
    peach: "bg-peach/30 border-peach/10",
  };

  return (
    <div
      className={`pixel-border flex flex-col rounded-2xl p-6 transition-all duration-200 ease-out sm:hover:-translate-y-1 sm:hover:rotate-[-1deg] sm:hover:shadow-[0_10px_0_0_rgba(0,0,0,0.35)] ${accents[accent] ?? accents.blush}`}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-display text-xl font-bold text-ink">{title}</h3>
        {price && (
          <div
            className={`flex shrink-0 rounded-xl bg-night/50 px-3 py-2 text-right ${
              priceStacked
                ? "flex-col items-end gap-0.5"
                : "items-baseline gap-1"
            }`}
          >
            <span className="text-2xl font-bold leading-none text-berry">
              {price}
            </span>
            {unit && (
              <span className="text-xs font-semibold text-ink/60">
                {unit}
              </span>
            )}
          </div>
        )}
      </div>

      {features.length > 0 && (
        <ul className="mt-4 space-y-1 text-sm text-ink/70">
          {features.map((feature) => (
            <li key={feature} className="flex items-start gap-2">
              <span className="text-ink/40">•</span>
              {feature}
            </li>
          ))}
        </ul>
      )}

      {bulk.length > 0 && (
        <div className="mt-4 border-t border-ink/10 pt-3">
          <p className="text-xs font-bold uppercase tracking-wide text-ink/50">
            {bulkLabel}
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {bulk.map((item) => (
              <li
                key={item.label}
                className="flex items-center justify-between gap-3"
              >
                <span className="text-ink/70">{item.label}</span>
                <span className="font-bold text-berry">{item.value}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
