import Link from "next/link";
import { QueueSpeedMark } from "@/components/QueueSpeedBadge";
import {
  QUEUE_SPEED_IMMEDIATE,
  QUEUE_SPEED_LABEL,
  QUEUE_SPEED_MIXED_COPY,
  QUEUE_SPEED_PUBLIC_HINT,
  QUEUE_SPEEDS_IN_LINE,
  queueSpeedControlClass,
  queueSpeedPriceTag,
} from "@/lib/queueSpeed";

function SpeedRow({ speed }) {
  return (
    <li className="flex items-start gap-3 rounded-lg border border-ink/10 bg-ink/[0.03] px-3 py-2.5">
      <span
        className={`mt-0.5 inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border ${queueSpeedControlClass(
          speed
        )}`}
        aria-hidden="true"
      >
        <QueueSpeedMark speed={speed} className="h-2.5 w-2.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-bold text-ink">
            {QUEUE_SPEED_LABEL[speed]}
          </span>
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink/55">
            {queueSpeedPriceTag(speed)}
          </span>
        </span>
        <span className="mt-0.5 block text-xs leading-snug text-ink/60">
          {QUEUE_SPEED_PUBLIC_HINT[speed]}
        </span>
      </span>
    </li>
  );
}

/**
 * Homepage / marketing explainer: wait-in-line vs skip-the-line.
 * Matches the quote picker grouping.
 */
export default function QueueSpeedGuide() {
  return (
    <div className="marketing-panel p-4 sm:p-6">
      <p className="mb-6 text-sm leading-relaxed text-ink/70">
        You pick a speed on each card — not on the whole order. Paying more
        moves that card further forward, or skips the waiting lanes entirely.
      </p>
      <div className="grid items-start gap-8 lg:grid-cols-2">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink/45">
            Wait in line
          </p>
          <p className="mt-1.5 text-sm leading-snug text-ink/60">
            You still wait. Paying moves this card further forward.
          </p>
          <ul className="mt-3 space-y-2">
            {QUEUE_SPEEDS_IN_LINE.map((speed) => (
              <SpeedRow key={speed} speed={speed} />
            ))}
          </ul>
        </div>

        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink/45">
            Skip the line
          </p>
          <p className="mt-1.5 text-sm leading-snug text-ink/60">
            Not a waiting lane. We start this card next.
          </p>
          <ul className="mt-3 space-y-2">
            <li className="rounded-lg border border-mint/40 bg-mint/[0.10] px-3 py-2.5">
              <span className="flex items-start gap-3">
                <span
                  className={`mt-0.5 inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border ${queueSpeedControlClass(
                    QUEUE_SPEED_IMMEDIATE
                  )}`}
                  aria-hidden="true"
                >
                  <QueueSpeedMark
                    speed={QUEUE_SPEED_IMMEDIATE}
                    className="h-2.5 w-2.5"
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-bold text-ink">
                      {QUEUE_SPEED_LABEL[QUEUE_SPEED_IMMEDIATE]}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink/55">
                      {queueSpeedPriceTag(QUEUE_SPEED_IMMEDIATE)}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-xs leading-snug text-ink/60">
                    {QUEUE_SPEED_PUBLIC_HINT[QUEUE_SPEED_IMMEDIATE]}
                  </span>
                </span>
              </span>
            </li>
          </ul>
        </div>
      </div>

      <p className="mt-6 text-sm leading-relaxed text-ink/60">
        {QUEUE_SPEED_MIXED_COPY}{" "}
        <Link
          href="/quote/"
          className="font-semibold text-ink underline decoration-ink/25 underline-offset-2 hover:decoration-ink/50"
        >
          Get a quote
        </Link>
        {" · "}
        <Link
          href="/queue/"
          className="font-semibold text-ink underline decoration-ink/25 underline-offset-2 hover:decoration-ink/50"
        >
          See the live queue
        </Link>
      </p>
    </div>
  );
}
