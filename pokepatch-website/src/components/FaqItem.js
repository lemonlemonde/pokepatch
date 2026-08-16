"use client";

import { useState } from "react";
import { ExpandPanel, REVEAL_EASE } from "@/components/ExpandReveal";

function FaqAnswer({ items, answer, className = "", dtClassName = "font-medium" }) {
  if (items) {
    return (
      <dl className={`space-y-2 ${className}`.trim()}>
        {items.map((item) => (
          <div key={item.label} className="flex flex-col gap-0.5">
            <dt className={`${dtClassName} text-ink`}>{item.label}</dt>
            <dd>{item.text}</dd>
          </div>
        ))}
      </dl>
    );
  }
  return <div className={className}>{answer}</div>;
}

export default function FaqItem({ question, answer, items, variant = "cozy" }) {
  const [open, setOpen] = useState(false);
  const isMarketing = variant === "marketing";

  if (isMarketing) {
    return (
      <div className="border-t border-ink/10">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          className="flex min-h-12 w-full cursor-pointer items-start justify-between gap-3 py-4 pr-1 text-left sm:items-baseline sm:gap-6 sm:py-5"
        >
          <span className="text-[15px] font-medium leading-snug text-ink/90 transition-colors hover:text-ink sm:text-base">
            {question}
          </span>
          <span
            aria-hidden="true"
            className={`mt-0.5 shrink-0 font-mono text-sm text-ink/40 transition-transform duration-300 ${REVEAL_EASE} ${
              open ? "rotate-45" : ""
            }`}
          >
            +
          </span>
        </button>
        <ExpandPanel
          open={open}
          innerClassName="max-w-2xl pb-6 text-sm leading-relaxed text-ink/60"
        >
          <FaqAnswer items={items} answer={answer} />
        </ExpandPanel>
      </div>
    );
  }

  return (
    <div className="pixel-border rounded-2xl border-ink/10 bg-cream/60 transition-colors duration-200 ease-out sm:hover:bg-cream/80">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center justify-between gap-4 px-5 py-4 text-left font-semibold text-ink"
      >
        {question}
        <span
          aria-hidden="true"
          className={`text-ink transition-transform duration-300 ${REVEAL_EASE} ${
            open ? "rotate-45" : ""
          }`}
        >
          +
        </span>
      </button>
      <ExpandPanel
        open={open}
        innerClassName="border-t border-ink/10 px-5 py-4 text-sm leading-relaxed text-ink/70"
      >
        <FaqAnswer items={items} answer={answer} dtClassName="font-bold" />
      </ExpandPanel>
    </div>
  );
}
