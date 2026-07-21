"use client";

import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabaseClient";

export default function QueueCount() {
  const [count, setCount] = useState(null);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;

    let cancelled = false;

    (async () => {
      try {
        const { data, error } = await supabase.rpc("get_queue_card_count");
        if (cancelled) return;
        if (error) {
          setCount(null);
          return;
        }
        const value = Number(data?.count);
        setCount(Number.isFinite(value) ? value : null);
      } catch {
        if (!cancelled) setCount(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (count == null) return null;

  const label =
    count === 1 ? "1 card currently in queue" : `${count} cards currently in queue`;

  return (
    <p
      className="mt-4 text-sm font-semibold text-ink/65 md:text-base"
      aria-live="polite"
    >
      {label}
    </p>
  );
}
