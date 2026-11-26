import {
  HOLDER_STANDARD_LABEL,
  PSA_READY_LABEL,
  cardIsPsaReady,
  psaReadyControlClass,
} from "@/lib/psaReady";

/** Nested card-in-holder mark for admin + customer PSA ready UI. */
export function PsaReadyMark({ className = "h-2.5 w-2.5" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M7.2 3.4h9.6A2.6 2.6 0 0 1 19.4 6v12a2.6 2.6 0 0 1-2.6 2.6H7.2A2.6 2.6 0 0 1 4.6 18V6A2.6 2.6 0 0 1 7.2 3.4zm.1 2.2c-.17 0-.3.13-.3.3v12.2c0 .17.13.3.3.3h9.4c.17 0 .3-.13.3-.3V5.9c0-.17-.13-.3-.3-.3H7.3z"
      />
      <rect x="8.35" y="7.15" width="7.3" height="9.7" rx="0.85" />
    </svg>
  );
}

/**
 * Per-card PSA ready mark. Hover shows a CSS tooltip — not a native title.
 */
export default function PsaReadyBadge({ card, active = null, className = "" }) {
  const on = active == null ? cardIsPsaReady(card) : Boolean(active);
  const label = on ? PSA_READY_LABEL : HOLDER_STANDARD_LABEL;
  return (
    <span
      className={`group relative inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border no-underline ${psaReadyControlClass(on)} ${className}`.trim()}
      aria-label={label}
    >
      <PsaReadyMark className="h-2.5 w-2.5" />
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-1 font-mono text-[10px] font-semibold normal-case tracking-normal text-cream opacity-0 shadow-sm transition-opacity duration-100 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}
