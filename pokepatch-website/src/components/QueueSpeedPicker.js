"use client";

import { QueueSpeedMark } from "@/components/QueueSpeedBadge";
import {
  QUEUE_SPEED_EXPRESS,
  QUEUE_SPEED_FAST,
  QUEUE_SPEED_FEE,
  QUEUE_SPEED_HINT,
  QUEUE_SPEED_IMMEDIATE,
  QUEUE_SPEED_LABEL,
  QUEUE_SPEED_STANDARD,
  QUEUE_SPEEDS_IN_LINE,
  normalizeQueueSpeed,
  queueSpeedControlClass,
} from "@/lib/queueSpeed";

const OPTION_TONE = {
  [QUEUE_SPEED_STANDARD]: {
    selected: "border-ink/25 bg-ink/[0.06] ring-1 ring-ink/15",
    idle: "border-ink/10 bg-ink/[0.03] hover:border-ink/20",
  },
  [QUEUE_SPEED_FAST]: {
    selected:
      "border-status-yellow/50 bg-status-yellow/10 ring-1 ring-status-yellow/30",
    idle: "border-ink/10 bg-ink/[0.03] hover:border-status-yellow/35",
  },
  [QUEUE_SPEED_EXPRESS]: {
    selected: "border-peach/50 bg-peach/10 ring-1 ring-peach/30",
    idle: "border-ink/10 bg-ink/[0.03] hover:border-peach/35",
  },
  [QUEUE_SPEED_IMMEDIATE]: {
    selected: "border-mint/55 bg-mint/15 ring-1 ring-mint/35",
    idle: "border-mint/25 bg-mint/[0.06] hover:border-mint/40",
  },
};

function SpeedOption({
  name,
  speed,
  selected,
  disabled,
  onChange,
}) {
  const checked = selected === speed;
  const tone = OPTION_TONE[speed];
  const inputId = `${name}-${speed}`;
  return (
    <label
      htmlFor={inputId}
      className={`flex cursor-pointer flex-col rounded-lg border px-3 py-2.5 transition-colors ${
        disabled ? "cursor-not-allowed opacity-60" : ""
      } ${checked ? tone.selected : tone.idle}`.trim()}
    >
      <input
        id={inputId}
        type="radio"
        name={name}
        value={speed}
        checked={checked}
        disabled={disabled}
        onChange={() => onChange?.(speed)}
        className="sr-only"
      />
      <span className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span
            className={`inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border ${queueSpeedControlClass(
              speed
            )}`}
            aria-hidden="true"
          >
            <QueueSpeedMark speed={speed} className="h-2.5 w-2.5" />
          </span>
          <span className="text-sm font-bold text-ink">
            {QUEUE_SPEED_LABEL[speed]}
          </span>
        </span>
        {QUEUE_SPEED_FEE[speed] > 0 ? (
          <span className="font-mono text-[11px] tabular-nums text-ink/55">
            ${QUEUE_SPEED_FEE[speed]}
          </span>
        ) : (
          <span className="font-mono text-[11px] uppercase tracking-wide text-ink/40">
            Included
          </span>
        )}
      </span>
      <span className="mt-1 text-xs leading-snug text-ink/60">
        {QUEUE_SPEED_HINT[speed]}
      </span>
    </label>
  );
}

/**
 * Per-card speed control. Waiting-lane options are one product (how far
 * forward in line). Immediate skips the waiting lanes.
 */
export default function QueueSpeedPicker({
  name,
  value,
  disabled = false,
  onChange,
  cardNumber = null,
}) {
  const selected = normalizeQueueSpeed(value);
  const cardLabel =
    cardNumber != null ? `card ${cardNumber}` : "this card";
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="mb-1 text-sm font-bold text-ink">
        Queue speed for {cardLabel}
      </legend>
      <p className="mb-3 text-xs leading-snug text-ink/55">
        Applies to {cardLabel} only. Cards on a different speed become a
        separate order.
      </p>

      <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-ink/45">
        Wait in line
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        {QUEUE_SPEEDS_IN_LINE.map((speed) => (
          <SpeedOption
            key={speed}
            name={name}
            speed={speed}
            selected={selected}
            disabled={disabled}
            onChange={onChange}
          />
        ))}
      </div>

      <p className="mb-2 mt-4 font-mono text-[10px] uppercase tracking-[0.16em] text-ink/45">
        Skip the line
      </p>
      <SpeedOption
        name={name}
        speed={QUEUE_SPEED_IMMEDIATE}
        selected={selected}
        disabled={disabled}
        onChange={onChange}
      />
    </fieldset>
  );
}
