/**
 * Compact "P" badge matching admin kanban priority.
 * Hover shows a CSS tooltip ("Priority") — not a native title (unreliable).
 */
export default function CustomerPriorityBadge({ className = "" }) {
  return (
    <span
      className={`group relative inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full border border-ink/35 bg-ink/15 px-1 text-[9px] font-bold uppercase leading-none tracking-[0.08em] text-ink no-underline ${className}`.trim()}
      aria-label="Priority"
    >
      P
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-1 font-mono text-[10px] font-semibold normal-case tracking-normal text-cream opacity-0 shadow-sm transition-opacity duration-100 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        Priority
      </span>
    </span>
  );
}
