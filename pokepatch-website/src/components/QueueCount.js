"use client";

import { useEffect, useState } from "react";
import MarketingSectionHeading from "@/components/marketing/MarketingSectionHeading";
import ScrollReveal from "@/components/marketing/ScrollReveal";
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
    <div className="flex flex-col border-l border-ink/15 py-1 pl-3 sm:pl-5 md:pl-6">
      <span className="tabular-nums text-3xl font-light tracking-tight text-ink sm:text-5xl md:text-6xl">
        {value}
      </span>
      <span className="mt-2 flex items-start gap-1.5 font-mono text-[9px] uppercase leading-snug tracking-[0.14em] text-ink/50 sm:mt-3 sm:items-center sm:gap-2 sm:text-[10px] sm:tracking-[0.2em]">
        <span
          className={`mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full sm:mt-0 ${dotClass} ${
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
    <section aria-label="Current restoration queue">
      <MarketingSectionHeading note="Workshop">
        Live queue
      </MarketingSectionHeading>
      <ScrollReveal>
        <div className="grid grid-cols-3 gap-2 sm:gap-4 md:gap-8">
          <StatTile
            value={todo}
            label="In Queue"
            dotClass="bg-status-yellow"
          />
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
            className="mt-6 font-mono text-[10px] uppercase tracking-[0.2em] text-ink/35"
            aria-live="polite"
          >
            Updated {updatedLabel}
          </p>
        ) : null}
      </ScrollReveal>
    </section>
  );
}
