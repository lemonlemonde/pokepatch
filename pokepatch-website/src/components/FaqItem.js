export default function FaqItem({ question, answer, items, variant = "cozy" }) {
  const isMarketing = variant === "marketing";

  if (isMarketing) {
    return (
      <details className="group border-t border-ink/10">
        <summary className="cursor-pointer list-none py-4 pr-1 marker:content-none min-h-12 sm:py-5 [&::-webkit-details-marker]:hidden">
          <span className="flex items-start justify-between gap-3 sm:items-baseline sm:gap-6">
            <span className="text-[15px] font-medium leading-snug text-ink/90 transition-colors group-hover:text-ink sm:text-base">
              {question}
            </span>
            <span
              aria-hidden="true"
              className="mt-0.5 shrink-0 font-mono text-sm text-ink/40 transition-transform duration-300 group-open:rotate-45"
            >
              +
            </span>
          </span>
        </summary>
        <div className="animate-fade-in max-w-2xl pb-6 text-sm leading-relaxed text-ink/60">
          {items ? (
            <dl className="space-y-2">
              {items.map((item) => (
                <div key={item.label} className="flex flex-col gap-0.5">
                  <dt className="font-medium text-ink">{item.label}</dt>
                  <dd>{item.text}</dd>
                </div>
              ))}
            </dl>
          ) : (
            answer
          )}
        </div>
      </details>
    );
  }

  return (
    <details className="pixel-border group rounded-2xl border-blush/10 bg-cream/60 transition-colors duration-200 ease-out sm:hover:bg-cream/80">
      <summary className="cursor-pointer list-none px-5 py-4 font-semibold text-ink marker:content-none [&::-webkit-details-marker]:hidden">
        <span className="flex items-center justify-between gap-4">
          {question}
          <span className="text-blush transition group-open:rotate-45">+</span>
        </span>
      </summary>
      <div className="animate-fade-in border-t border-ink/10 px-5 py-4 text-sm leading-relaxed text-ink/70">
        {items ? (
          <dl className="space-y-2">
            {items.map((item) => (
              <div key={item.label} className="flex flex-col gap-0.5">
                <dt className="font-bold text-ink">{item.label}</dt>
                <dd>{item.text}</dd>
              </div>
            ))}
          </dl>
        ) : (
          answer
        )}
      </div>
    </details>
  );
}
