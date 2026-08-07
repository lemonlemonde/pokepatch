/**
 * Shared page title for public routes — dark editorial style.
 * Prefer `note` for a short mono label; `subtitle` for a supporting sentence.
 * Use `variant="section"` for denser admin-style headings.
 * Pass `as="h1"` on primary page titles for SEO.
 */
export default function SectionHeading({
  children,
  subtitle,
  note,
  align = "left",
  variant = "page",
  as: Tag = "h2",
}) {
  const isSection = variant === "section";
  const alignClass = isSection
    ? "text-center"
    : align === "center"
      ? "mx-auto max-w-2xl text-center"
      : "max-w-3xl text-left";

  return (
    <header className={`${isSection ? "mb-8" : "mb-8 sm:mb-10 md:mb-12"} ${alignClass}`}>
      {note ? (
        <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.22em] text-ink/40 sm:text-[11px] sm:tracking-[0.28em]">
          {note}
        </p>
      ) : null}
      <Tag
        className={
          isSection
            ? "text-3xl font-bold text-ink md:text-4xl"
            : "text-[1.85rem] font-medium leading-tight tracking-[-0.02em] text-ink sm:text-4xl md:text-5xl"
        }
      >
        {children}
      </Tag>
      {subtitle ? (
        <p
          className={
            isSection
              ? "mt-2 text-sm text-ink/60 md:text-base"
              : "mt-3 text-sm leading-relaxed text-ink/55 md:text-base"
          }
        >
          {subtitle}
        </p>
      ) : null}
    </header>
  );
}
