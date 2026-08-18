/**
 * Modular extras / fees panel — one shell, equal columns.
 * Uses a gap grid so 2–4 items stay even.
 */
export default function ServiceModifiersCard({ panels = [] }) {
  const columnClass =
    panels.length >= 4
      ? "sm:grid-cols-2 lg:grid-cols-4"
      : panels.length === 3
        ? "sm:grid-cols-3"
        : panels.length === 2
          ? "sm:grid-cols-2"
          : "sm:grid-cols-1";

  return (
    <div className="marketing-panel p-4 sm:p-6">
      <div className={`grid items-start gap-8 ${columnClass}`}>
        {panels.map((panel) => (
          <div key={panel.title} className="min-w-0">
            <h3 className="text-lg font-medium tracking-tight text-ink">
              {panel.title}
            </h3>

            {panel.features?.length === 1 ? (
              <p className="mt-1.5 text-sm leading-snug text-ink/60">
                {panel.features[0]}
              </p>
            ) : panel.features?.length > 1 ? (
              <ul className="mt-2 space-y-1 text-sm text-ink/60">
                {panel.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <span className="text-ink/35">—</span>
                    {feature}
                  </li>
                ))}
              </ul>
            ) : null}

            {panel.bulk?.length > 0 ? (
              <div
                className={
                  panel.features?.length > 0
                    ? "mt-3 border-t border-ink/10 pt-2.5"
                    : "mt-3"
                }
              >
                {panel.bulkLabel ? (
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/45">
                    {panel.bulkLabel}
                  </p>
                ) : null}
                <ul
                  className={`space-y-1.5 text-sm ${
                    panel.bulkLabel ? "mt-2" : ""
                  }`}
                >
                  {panel.bulk.map((item) => (
                    <li key={item.label}>
                      <span className="text-ink/60">{item.label}</span>
                      <span className="ml-2 font-mono tabular-nums text-ink">
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
