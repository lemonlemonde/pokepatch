"use client";

import { useEffect, useState } from "react";
import { deleteDraft, getDraft, putDraft } from "@/lib/studioDraftDb";

const SAVE_DEBOUNCE_MS = 500;

/**
 * Persist a formatter's in-progress work (uploaded files, crops,
 * annotations, pair/slot placement) across refresh.
 *
 * On mount, loads `key` once and returns it as `restored` — `undefined`
 * while loading, `null` if nothing was stored, otherwise the saved
 * payload. Callers apply it in a `useEffect` keyed on `restored`.
 *
 * Once that initial load has resolved, `value` is auto-saved (debounced)
 * whenever `hasContent` is true, and the stored draft is deleted when
 * `hasContent` goes false — so clearing every photo doesn't leave a stale
 * draft to resurrect on the next visit.
 */
export default function useStudioDraft(key, value, hasContent) {
  const [restored, setRestored] = useState(undefined);

  useEffect(() => {
    let cancelled = false;
    setRestored(undefined);
    getDraft(key).then((data) => {
      if (!cancelled) setRestored(data);
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  useEffect(() => {
    if (restored === undefined) return undefined; // don't save until the initial load resolves

    const timer = setTimeout(() => {
      if (hasContent) {
        putDraft(key, value);
      } else {
        deleteDraft(key);
      }
    }, SAVE_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [restored, key, hasContent, value]);

  return restored;
}
