"use client";

import useCenterActive from "@/hooks/useCenterActive";

export default function FaqItem({ question, answer, items }) {
  const { ref, active } = useCenterActive();

  return (
    <details
      ref={ref}
      className={`pixel-border group rounded-2xl border-blush bg-white/60 transition-all duration-200 ease-out hover:-translate-y-1 hover:shadow-[0_10px_0_0_rgba(74,63,85,0.2)] ${
        active ? "-translate-y-1 shadow-[0_10px_0_0_rgba(74,63,85,0.2)]" : ""
      }`}
    >
      <summary className="cursor-pointer list-none px-5 py-4 font-semibold text-ink marker:content-none [&::-webkit-details-marker]:hidden">
        <span className="flex items-center justify-between gap-4">
          {question}
          <span className="text-blush transition group-open:rotate-45">+</span>
        </span>
      </summary>
      <div className="border-t border-ink/10 px-5 py-4 font-secondary text-sm leading-relaxed text-ink/70">
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
