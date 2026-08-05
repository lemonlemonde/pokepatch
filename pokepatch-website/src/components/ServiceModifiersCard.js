/**
 * One card holding the two order-level modifiers (bulk pricing, high-value
 * handling), split by a divider — vertical on desktop, horizontal stacked.
 */
export default function ServiceModifiersCard({ panels = [], accent = "mint" }) {
  const accents = {
    blush: "bg-blush/30 border-blush/10",
    mint: "bg-mint/30 border-mint/10",
    lavender: "bg-lavender/30 border-lavender/10",
    peach: "bg-peach/30 border-peach/10",
    sky: "bg-sky/30 border-sky/10",
  };

  return (
    <div
      className={`pixel-border rounded-2xl p-6 transition-all duration-200 ease-out sm:col-span-2 sm:hover:-translate-y-1 sm:hover:shadow-[0_10px_0_0_rgba(0,0,0,0.35)] ${
        accents[accent] ?? accents.mint
      }`}
    >
      <div className="grid gap-5 sm:grid-cols-2 sm:gap-0">
        {panels.map((panel, index) => (
          <div
            key={panel.title}
            className={
              index === 0
                ? "sm:pr-6"
                : "border-t border-ink/15 pt-5 sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0"
            }
          >
            <h3 className="font-display text-xl font-bold text-ink">
              {panel.title}
            </h3>

            {panel.features?.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm text-ink/70">
                {panel.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <span className="text-ink/40">•</span>
                    {feature}
                  </li>
                ))}
              </ul>
            )}

            {panel.bulk?.length > 0 && (
              <div className="mt-4 border-t border-ink/10 pt-3">
                <p className="text-xs font-bold uppercase tracking-wide text-ink/50">
                  {panel.bulkLabel}
                </p>
                <ul className="mt-2 space-y-1 text-sm">
                  {panel.bulk.map((item) => (
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
        ))}
      </div>
    </div>
  );
}
