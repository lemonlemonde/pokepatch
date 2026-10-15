"use client";

const ACCENTS = {
  sky: {
    bar: "bg-sky",
    badge: "bg-sky/25 text-ink",
    glow: "from-sky/15 via-transparent to-transparent",
  },
  peach: {
    bar: "bg-peach",
    badge: "bg-peach/30 text-ink",
    glow: "from-peach/15 via-transparent to-transparent",
  },
  mint: {
    bar: "bg-mint",
    badge: "bg-mint/25 text-ink",
    glow: "from-mint/15 via-transparent to-transparent",
  },
  ink: {
    bar: "bg-ink/40",
    badge: "bg-ink/10 text-ink/80",
    glow: "from-ink/10 via-transparent to-transparent",
  },
};

/** Framed panel for one Tasks board module. */
export default function AdminTaskModule({
  title,
  eyebrow = "Task",
  description,
  accent = "ink",
  count = null,
  countLabel,
  actions = null,
  children,
  className = "",
}) {
  const palette = ACCENTS[accent] ?? ACCENTS.ink;
  const showCount = count != null && Number.isFinite(Number(count));

  return (
    <article
      className={`relative flex min-h-[22rem] flex-col overflow-hidden rounded-2xl border border-ink/12 bg-ink/[0.025] shadow-[0_1px_0_rgba(255,255,255,0.04)_inset] ${className}`}
    >
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b ${palette.glow}`}
      />
      <div
        aria-hidden="true"
        className={`absolute inset-x-0 top-0 h-1 ${palette.bar}`}
      />

      <header className="relative flex flex-wrap items-start justify-between gap-3 border-b border-ink/10 px-5 pb-4 pt-5">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink/40">
            {eyebrow}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
            <h2 className="text-lg font-bold tracking-tight text-ink sm:text-xl">
              {title}
            </h2>
            {showCount ? (
              <span
                className={`inline-flex min-w-7 items-center justify-center rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums ${palette.badge}`}
                title={countLabel}
              >
                {Number(count) > 99 ? "99+" : Number(count)}
              </span>
            ) : null}
          </div>
          {description ? (
            <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-ink/55">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
          </div>
        ) : null}
      </header>

      <div className="relative flex flex-1 flex-col px-5 py-4">{children}</div>
    </article>
  );
}

export function taskRefreshButtonClassName() {
  return "rounded-lg border border-ink/15 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-ink/60 transition hover:border-ink/30 hover:text-ink disabled:opacity-40";
}
