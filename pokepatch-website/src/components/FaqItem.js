export default function FaqItem({ question, answer, items }) {
  return (
    <details className="pixel-border group rounded-2xl border-blush/10 bg-cream/60 transition-all duration-200 ease-out sm:hover:-translate-y-1 sm:hover:shadow-[0_10px_0_0_rgba(0,0,0,0.35)]">
      <summary className="cursor-pointer list-none px-5 py-4 font-semibold text-ink marker:content-none [&::-webkit-details-marker]:hidden">
        <span className="flex items-center justify-between gap-4">
          {question}
          <span className="text-blush transition group-open:rotate-45">+</span>
        </span>
      </summary>
      <div className="border-t border-ink/10 px-5 py-4 text-sm leading-relaxed text-ink/70">
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
