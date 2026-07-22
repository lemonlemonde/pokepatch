"use client";

import { useEffect, useState } from "react";
import SectionHeading from "@/components/SectionHeading";
import { supabase, isSupabaseConfigured } from "@/lib/supabaseClient";

function parseCount(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Format an instant in the visitor's locale and timezone (with zone abbrev). */
function formatUpdatedAt(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZoneName: "short",
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

function StatTile({ value, label, dotClass, pulse }) {
  return (
    <div className="pixel-border flex flex-col items-center rounded-2xl border-blush/10 bg-cream/60 px-3 py-4 sm:py-5">
      <span className="font-secondary tabular-nums text-3xl font-bold text-ink sm:text-4xl">
        {value}
      </span>
      <span className="mt-1.5 flex flex-wrap items-center justify-center gap-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-ink/60 sm:text-sm">
        <span
          className={`inline-block h-2 w-2 shrink-0 rounded-full ${dotClass} ${
            pulse ? "animate-pulse" : ""
          }`}
          aria-hidden="true"
        />
        {label}
      </span>
    </div>
  );
}

export default function QueueCount() {
  const [todo, setTodo] = useState(null);
  const [inProgress, setInProgress] = useState(null);
  const [completed, setCompleted] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;

    let cancelled = false;

    (async () => {
      try {
        const { data, error } = await supabase.rpc("get_queue_card_count");
        if (cancelled) return;
        if (error) {
          setTodo(null);
          setInProgress(null);
          setCompleted(null);
          setUpdatedAt(null);
          return;
        }
        setTodo(parseCount(data?.todo));
        setInProgress(parseCount(data?.in_progress));
        setCompleted(parseCount(data?.completed));
        setUpdatedAt(new Date());
      } catch {
        if (!cancelled) {
          setTodo(null);
          setInProgress(null);
          setCompleted(null);
          setUpdatedAt(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (todo == null || inProgress == null || completed == null) return null;

  const updatedLabel = formatUpdatedAt(updatedAt);

  return (
    <section
      className="mb-16 animate-fade-up [animation-delay:80ms]"
      aria-label="Current restoration queue"
    >
      <SectionHeading subtitle="Cards currently in the workshop">
        Live Queue
      </SectionHeading>
      <div className="mx-auto grid max-w-xl grid-cols-3 gap-3 sm:gap-4">
        <StatTile value={todo} label="In Queue" dotClass="bg-status-yellow" />
        <StatTile
          value={inProgress}
          label="In Progress"
          dotClass="bg-status-blue"
          pulse
        />
        <StatTile
          value={completed}
          label="Restored"
          dotClass="bg-status-green"
        />
      </div>
      {updatedLabel ? (
        <p
          className="mt-2.5 text-center text-xs font-medium text-ink/45"
          aria-live="polite"
        >
          Updated {updatedLabel}
        </p>
      ) : null}
    </section>
  );
}
