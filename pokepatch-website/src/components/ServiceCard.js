export default function ServiceCard({
  title,
  price,
  unit,
  priceStacked = false,
  priceNote = null,
  features = [],
  featuresLabel = null,
  bulk = [],
  bulkLabel = "Bulk Pricing",
  accent,
  variant = "cozy",
}) {
  const accents = {
    ink: "bg-ink/20 border-ink/15",
    mint: "bg-mint/30 border-mint/10",
    lavender: "bg-lavender/30 border-lavender/10",
    peach: "bg-peach/30 border-peach/10",
    sky: "bg-sky/30 border-sky/10",
  };

  const isMarketing = variant === "marketing";
  const shellClass = isMarketing
    ? "marketing-panel h-full p-4 sm:p-6"
    : `pixel-border rounded-2xl p-6 transition-all duration-200 ease-out sm:hover:-translate-y-1 sm:hover:rotate-[-1deg] sm:hover:shadow-[0_10px_0_0_rgba(0,0,0,0.35)] ${accents[accent] ?? accents.ink}`;

  return (
    <div className={`flex h-full flex-col ${shellClass}`}>
      <div className="flex items-start justify-between gap-3">
        <h3
          className={
            isMarketing
              ? "text-lg font-medium tracking-tight text-ink"
              : "font-display text-xl font-bold text-ink"
          }
        >
          {title}
        </h3>
        {price && (
          <div
            className={`flex shrink-0 text-right ${
              isMarketing
                ? "rounded-lg bg-ink/5 px-3 py-2 ring-1 ring-ink/10"
                : "rounded-xl bg-night/50 px-3 py-2"
            } ${
              priceStacked
                ? "flex-col items-end gap-0.5"
                : "items-baseline gap-1"
            }`}
          >
            <span
              className={
                isMarketing
                  ? "font-mono text-xl leading-none text-ink"
                  : "text-2xl font-bold leading-none text-ink"
              }
            >
              {price}
            </span>
            {unit && (
              <span
                className={
                  isMarketing
                    ? "font-mono text-[10px] uppercase tracking-[0.12em] text-ink/50"
                    : "text-xs font-semibold text-ink/60"
                }
              >
                {unit}
              </span>
            )}
            {priceNote ? (
              <span
                className={
                  isMarketing
                    ? "font-mono text-[9px] uppercase leading-tight tracking-[0.1em] text-ink/40"
                    : "text-[10px] font-semibold leading-tight text-ink/50"
                }
              >
                {priceNote}
              </span>
            ) : null}
          </div>
        )}
      </div>

      {features.length > 0 && (
        <div className="mt-4">
          {featuresLabel ? (
            <p
              className={
                isMarketing
                  ? "font-mono text-[10px] uppercase tracking-[0.2em] text-ink/45"
                  : "text-xs font-bold uppercase tracking-wide text-ink/50"
              }
            >
              {featuresLabel}
            </p>
          ) : null}
          <ul
            className={`space-y-1 text-sm ${
              featuresLabel ? "mt-2" : ""
            } ${isMarketing ? "text-ink/60" : "text-ink/70"}`}
          >
            {features.map((feature) => (
              <li key={feature} className="flex items-start gap-2">
                <span className="text-ink/35">{isMarketing ? "—" : "•"}</span>
                {feature}
              </li>
            ))}
          </ul>
        </div>
      )}

      {bulk.length > 0 && (
        <div className="mt-4 border-t border-ink/10 pt-3">
          <p
            className={
              isMarketing
                ? "font-mono text-[10px] uppercase tracking-[0.2em] text-ink/45"
                : "text-xs font-bold uppercase tracking-wide text-ink/50"
            }
          >
            {bulkLabel}
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {bulk.map((item) => (
              <li
                key={item.label}
                className="flex items-center justify-between gap-3"
              >
                <span className={isMarketing ? "text-ink/60" : "text-ink/70"}>
                  {item.label}
                </span>
                <span
                  className={
                    isMarketing
                      ? "font-mono tabular-nums text-ink"
                      : "font-bold text-ink"
                  }
                >
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
