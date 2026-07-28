"use client";

import { useEffect } from "react";

const DEFAULT_MESSAGE =
  "You have unsaved changes. Leave without saving?";

/**
 * Guard against losing in-progress edits:
 * - beforeunload for refresh / tab close
 * - capture-phase click on same-origin <a> for in-app Link navigation
 *
 * Programmatic router.push/replace (e.g. admin tab buttons) must still call
 * confirmUnsavedChanges() (or window.confirm) themselves.
 */
export function confirmUnsavedChanges(message = DEFAULT_MESSAGE) {
  if (typeof window === "undefined") return true;
  return window.confirm(message);
}

export function useUnsavedChangesGuard(isDirty, message = DEFAULT_MESSAGE) {
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

      const anchor = event.target instanceof Element
        ? event.target.closest("a[href]")
        : null;
      if (!anchor) return;
      if (anchor.getAttribute("download") != null) return;
      if (anchor.target && anchor.target !== "_self") return;

      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) {
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

      if (!confirmUnsavedChanges(message)) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onDocumentClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onDocumentClick, true);
    };
  }, [isDirty, message]);
}
