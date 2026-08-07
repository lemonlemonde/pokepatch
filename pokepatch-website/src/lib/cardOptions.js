import { useEffect, useState } from "react";
import { adminListCardOptions } from "@/lib/adminApi";

/** Module-level cache so every mounted picker shares one fetch per admin session. */
let cachedPromise = null;

function fetchCardOptions() {
  if (!cachedPromise) {
    cachedPromise = adminListCardOptions().catch((err) => {
      cachedPromise = null;
      throw err;
    });
  }
  return cachedPromise;
}

/**
 * Live card name/set suggestions, sourced from cards already stored on
 * orders. Used to back <datalist> autocomplete in the Studio formatter and
 * gallery uploads — not the admin-curated Set library abbreviations.
 */
export function useCardOptions() {
  const [options, setOptions] = useState({ cardNames: [], setNames: [] });

  useEffect(() => {
    let cancelled = false;
    fetchCardOptions()
      .then((result) => {
        if (!cancelled) setOptions(result);
      })
      .catch(() => {
        // Suggestions are a nice-to-have; typing still works with none loaded.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return options;
}
