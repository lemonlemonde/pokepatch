/**
 * One card holding order-level modifiers (priority, bulk, high-value handling),
 * split by dividers — three columns on desktop, stacked on mobile.
 */
export default function ServiceModifiersCard({
  panels = [],
  accent = "mint",
  variant = "cozy",
}) {
  const accents = {
    blush: "bg-blush/30 border-blush/10",
    mint: "bg-mint/30 border-mint/10",
    lavender: "bg-lavender/30 border-lavender/10",
    peach: "bg-peach/30 border-peach/10",
    sky: "bg-sky/30 border-sky/10",
  };

  const isMarketing = variant === "marketing";
  const shellClass = isMarketing
    ? "marketing-panel h-full p-4 sm:p-6"
    : `pixel-border rounded-2xl p-6 transition-all duration-200 ease-out sm:col-span-2 sm:hover:-translate-y-1 sm:hover:shadow-[0_10px_0_0_rgba(0,0,0,0.35)] ${accents[accent] ?? accents.mint}`;

  const columnClass =
    panels.length >= 3
      ? "sm:grid-cols-3"
      : panels.length === 2
        ? "sm:grid-cols-2"
        : "sm:grid-cols-1";

  function panelClassName(index, total) {
    const parts = ["min-w-0"];
    if (index > 0) {
      parts.push(
        "border-t border-ink/15 pt-5 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0"
      );
    }
    if (total > 1) {
      if (index === 0) parts.push("sm:pr-5");
      else if (index === total - 1) parts.push("sm:pl-5");
      else parts.push("sm:px-5");
    }
    return parts.join(" ");
  }

  return (
    <div className={shellClass}>
      <div className={`grid items-start gap-5 sm:gap-0 ${columnClass}`}>
        {panels.map((panel, index) => (
          <div
            key={panel.title}
            className={panelClassName(index, panels.length)}
          >
            <h3
              className={
                isMarketing
                  ? "text-lg font-medium tracking-tight text-ink"
                  : "font-display text-xl font-bold text-ink"
              }
            >
              {panel.title}
            </h3>

            {panel.features?.length === 1 ? (
              <p
                className={`mt-1.5 text-sm leading-snug ${
                  isMarketing ? "text-ink/60" : "text-ink/70"
                }`}
              >
                {panel.features[0]}
              </p>
            ) : panel.features?.length > 1 ? (
              <ul
                className={`mt-2 space-y-1 text-sm ${
                  isMarketing ? "text-ink/60" : "text-ink/70"
                }`}
              >
                {panel.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <span className="text-ink/35">
                      {isMarketing ? "—" : "•"}
                    </span>
                    {feature}
                  </li>
                ))}
              </ul>
            ) : null}

            {panel.bulk?.length > 0 ? (
              <div className="mt-3 border-t border-ink/10 pt-2.5">
                <p
                  className={
                    isMarketing
                      ? "font-mono text-[10px] uppercase tracking-[0.2em] text-ink/45"
                      : "text-xs font-bold uppercase tracking-wide text-ink/50"
                  }
                >
                  {panel.bulkLabel}
                </p>
                <ul className="mt-2 space-y-1.5 text-sm">
                  {panel.bulk.map((item) => (
                    <li key={item.label}>
                      <span
                        className={isMarketing ? "text-ink/60" : "text-ink/70"}
                      >
                        {item.label}
                      </span>
                      <span
                        className={`ml-2 tabular-nums ${
                          isMarketing
                            ? "font-mono text-ink"
                            : "font-bold text-berry"
                        }`}
                      >
                        {item.value}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
