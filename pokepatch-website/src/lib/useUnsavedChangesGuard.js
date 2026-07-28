"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import UnsavedChangesDialog from "@/components/UnsavedChangesDialog";

/**
 * Guard against losing in-progress edits:
 * - Native beforeunload for refresh / tab close (browsers block custom UI there)
 * - Styled dialog for in-app <a> navigation and programmatic requestLeave()
 */
export function useUnsavedChangesGuard(isDirty) {
  const [pending, setPending] = useState(null);
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;

  const closePending = useCallback((shouldLeave) => {
    setPending((current) => {
      if (current?.resolve) current.resolve(shouldLeave);
      return null;
    });
  }, []);

  const requestLeave = useCallback(() => {
    if (!isDirtyRef.current) return Promise.resolve(true);
    return new Promise((resolve) => {
      setPending({ resolve });
    });
  }, []);

  useEffect(() => {
    if (!isDirty) return undefined;

    function onBeforeUnload(event) {
      event.preventDefault();
      event.returnValue = "";
    }

    function onDocumentClick(event) {
      if (event.defaultPrevented) return;
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }

      const anchor =
        event.target instanceof Element
          ? event.target.closest("a[href]")
          : null;
      if (!anchor) return;
      if (anchor.getAttribute("download") != null) return;
      if (anchor.target && anchor.target !== "_self") return;

      const href = anchor.getAttribute("href");
      if (
        !href ||
        href.startsWith("#") ||
        href.startsWith("mailto:") ||
        href.startsWith("tel:")
      ) {
        return;
      }

      let next;
      try {
        next = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (next.origin !== window.location.origin) return;
      if (
        next.pathname === window.location.pathname &&
        next.search === window.location.search &&
        next.hash === window.location.hash
      ) {
        return;
      }

      if (!isDirtyRef.current) return;

      event.preventDefault();
      event.stopPropagation();

      const destination = `${next.pathname}${next.search}${next.hash}`;
      setPending({
        resolve: (shouldLeave) => {
          if (shouldLeave) {
            window.location.assign(destination);
          }
        },
      });
    }

    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onDocumentClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onDocumentClick, true);
    };
  }, [isDirty]);

  const dialog = (
    <UnsavedChangesDialog
      open={Boolean(pending)}
      onStay={() => closePending(false)}
      onLeave={() => closePending(true)}
    />
  );

  return { requestLeave, dialog };
}
