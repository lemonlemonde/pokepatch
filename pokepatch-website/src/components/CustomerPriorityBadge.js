/**
 * Yellow star in a circle — shared priority mark for customer + admin UI.
 * Hover shows a CSS tooltip ("Priority") — not a native title (unreliable).
 */

export function PriorityStarIcon({ className = "h-2.5 w-2.5" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 2.8l2.35 5.72 6.2.54-4.72 4.1 1.42 6.06L12 16.2l-5.25 3.02 1.42-6.06-4.72-4.1 6.2-.54L12 2.8z" />
    </svg>
  );
}

export default function CustomerPriorityBadge({ className = "" }) {
  return (
    <span
      className={`group relative inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-status-yellow/55 bg-status-yellow/15 text-status-yellow no-underline ${className}`.trim()}
      aria-label="Priority"
    >
      <PriorityStarIcon className="h-2.5 w-2.5" />
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-1 font-mono text-[10px] font-semibold normal-case tracking-normal text-cream opacity-0 shadow-sm transition-opacity duration-100 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        Priority
      </span>
    </span>
  );
}
