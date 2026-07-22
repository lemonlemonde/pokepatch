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

function Stat({ value, label }) {
  return (
    <span className="inline-flex items-baseline">
      <span className="tabular-nums text-xl text-berry sm:text-2xl md:text-3xl">
        {value}
      </span>
      <span className="ml-2.5 text-base font-semibold text-ink/70 sm:ml-3 sm:text-lg">
        {label}
      </span>
    </span>
  );
}

function Dot() {
  return (
    <span
      className="mx-6 inline-block text-4xl font-bold leading-none text-ink/40 sm:mx-8 sm:text-5xl"
      aria-hidden="true"
    >
      ·
    </span>
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
      <div className="pixel-border mx-auto max-w-xl rounded-2xl border-blush/10 bg-cream/60 px-4 py-4 text-center font-secondary sm:px-5 sm:py-5">
        <p className="font-bold text-ink">
          <span className="tabular-nums text-3xl text-berry sm:text-4xl">
            {completed}
          </span>
          <span className="ml-2.5 text-lg font-semibold text-ink/70 sm:ml-3 sm:text-xl">
            restored
          </span>
        </p>
        <p className="mt-3 flex flex-wrap items-center justify-center font-bold text-ink sm:mt-3.5">
          <Stat value={todo} label="in queue" />
          <Dot />
          <Stat value={inProgress} label="in progress" />
        </p>
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
