"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * `value`, held back until it has stopped changing for `delayMs`.
 *
 * Used to keep fast-changing text out of a draft payload: the input itself
 * stays fully responsive, while the payload — and so the IndexedDB write that
 * carries every uploaded photo with it — only moves once typing pauses.
 *
 * Returns `[debounced, flush]`. Call `flush(next)` when the value changes for
 * some reason other than typing (a draft restore, a reset): without it the
 * debounced copy stays stale for `delayMs`, and a save triggered meanwhile by
 * some *other* part of the payload would persist that stale text.
 */
export default function useDebouncedValue(value, delayMs) {
  const [debounced, setDebounced] = useState(value);
  const timerRef = useRef(null);

  useEffect(() => {
    timerRef.current = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timerRef.current);
  }, [value, delayMs]);

  const flush = useCallback((next) => {
    clearTimeout(timerRef.current);
    setDebounced(next);
  }, []);

  return [debounced, flush];
}
