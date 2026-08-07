import ScrollReveal from "@/components/marketing/ScrollReveal";

/**
 * Editorial section header for the marketing page.
 * Mono note + hairline rule reads like a catalog entry.
 */
export default function MarketingSectionHeading({ note, children }) {
  return (
    <ScrollReveal as="header" variant="dramatic" className="mb-8 sm:mb-12 md:mb-14">
      {note ? (
        <div className="mb-3 flex items-center gap-4 sm:mb-4">
          <p className="shrink-0 font-mono text-[10px] uppercase tracking-[0.22em] text-ink/40 sm:text-[11px] sm:tracking-[0.28em]">
            {note}
          </p>
          <div className="h-px min-w-0 flex-1 bg-ink/10" aria-hidden="true" />
        </div>
      ) : null}
      <h2 className="max-w-xl text-[1.85rem] font-medium leading-tight tracking-[-0.02em] text-ink sm:max-w-2xl sm:text-4xl md:text-5xl">
        {children}
      </h2>
    </ScrollReveal>
  );
}
