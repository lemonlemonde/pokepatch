"use client";

import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabaseClient";

function parseCount(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export default function QueueCount() {
  const [todo, setTodo] = useState(null);
  const [inProgress, setInProgress] = useState(null);

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
          return;
        }
        setTodo(parseCount(data?.todo));
        setInProgress(parseCount(data?.in_progress));
      } catch {
        if (!cancelled) {
          setTodo(null);
          setInProgress(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (todo == null || inProgress == null) return null;

  const todoLabel = todo === 1 ? "1 card to-do" : `${todo} cards to-do`;
  const progressLabel =
    inProgress === 1
      ? "1 card in progress"
      : `${inProgress} cards in progress`;

  return (
    <p
      className="mt-4 text-sm font-semibold text-ink/65 md:text-base"
      aria-live="polite"
    >
      {todoLabel}
      <span className="mx-2 text-ink/35" aria-hidden="true">
        ·
      </span>
      {progressLabel}
    </p>
  );
}
