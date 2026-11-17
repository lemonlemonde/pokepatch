import {
  QUEUE_SPEED_EXPRESS,
  QUEUE_SPEED_FAST,
  QUEUE_SPEED_IMMEDIATE,
  QUEUE_SPEED_LABEL,
  normalizeQueueSpeed,
  queueSpeedControlClass,
} from "@/lib/queueSpeed";

function StandardClockIcon({ className = "h-2.5 w-2.5" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M12 3.1a8.9 8.9 0 1 0 0 17.8 8.9 8.9 0 0 0 0-17.8zM5.6 12a6.4 6.4 0 1 1 12.8 0 6.4 6.4 0 0 1-12.8 0z"
      />
      <path d="M12 7.15c.4 0 .72.32.72.72v4.05l2.78 1.8a.72.72 0 1 1-.76 1.22l-3.12-2.02A.72.72 0 0 1 11.28 12.3V7.87c0-.4.32-.72.72-.72z" />
    </svg>
  );
}

function PriorityStarIcon({ className = "h-2.5 w-2.5" }) {
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

function RushBoltIcon({ className = "h-2.5 w-2.5" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M13.4 2.2 4.7 13.4c-.35.45-.03 1.1.54 1.1h6.02l-1.66 7.3c-.12.54.55.9.9.48l8.7-11.2c.35-.45.03-1.1-.54-1.1H12.6l1.7-7.3c.12-.54-.55-.9-.9-.48z" />
    </svg>
  );
}

function ImmediatePlayIcon({ className = "h-2.5 w-2.5" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M8.2 5.1v13.8c0 .7.8 1.1 1.4.7l10.2-6.9c.6-.4.6-1.3 0-1.7L9.6 4.4c-.6-.4-1.4 0-1.4.7z" />
    </svg>
  );
}

export function QueueSpeedMark({ speed, className = "h-2.5 w-2.5" }) {
  if (speed === QUEUE_SPEED_IMMEDIATE) {
    return <ImmediatePlayIcon className={className} />;
  }
  if (speed === QUEUE_SPEED_EXPRESS) {
    return <RushBoltIcon className={className} />;
  }
  if (speed === QUEUE_SPEED_FAST) {
    return <PriorityStarIcon className={className} />;
  }
  return <StandardClockIcon className={className} />;
}

function toneClass(speed) {
  return queueSpeedControlClass(speed);
}

/**
 * Speed mark for customer + admin UI.
 * Hover shows a CSS tooltip — not a native title (unreliable).
 */
export default function QueueSpeedBadge({
  speed,
  isPriority = false,
  className = "",
}) {
  const normalized = normalizeQueueSpeed(speed, { isPriority });
  const label = QUEUE_SPEED_LABEL[normalized];
  return (
    <span
      className={`group relative inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border no-underline ${toneClass(normalized)} ${className}`.trim()}
      aria-label={label}
    >
      <QueueSpeedMark speed={normalized} className="h-2.5 w-2.5" />
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-1 font-mono text-[10px] font-semibold normal-case tracking-normal text-cream opacity-0 shadow-sm transition-opacity duration-100 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}

