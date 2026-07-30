"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import UnsavedChangesDialog from "@/components/UnsavedChangesDialog";

/**
 * Guard against losing in-progress edits:
 * - Native beforeunload for refresh / tab close (browsers block custom UI there)
 * - Styled dialog for in-app <a> clicks, browser back/forward, and requestLeave()
 */
export function useUnsavedChangesGuard(isDirty) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const isDirtyRef = useRef(isDirty);
  const bypassRef = useRef(false);
  const askingRef = useRef(false);
  const dirtyUrlRef = useRef("");
  // Holds the resolver for the in-flight prompt. Kept in a ref (not state) so
  // resolving it — which can synchronously navigate via router.push — never
  // runs inside a setState updater, which React forbids ("Cannot update a
  // component while rendering a different component").
  const resolverRef = useRef(null);

  isDirtyRef.current = isDirty;

  useEffect(() => {
    if (!isDirty || typeof window === "undefined") return;
    dirtyUrlRef.current =
      window.location.pathname + window.location.search + window.location.hash;
  }, [isDirty]);

  const closePending = useCallback((shouldLeave) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    askingRef.current = false;
    setPending(false);
    if (resolve) resolve(shouldLeave);
  }, []);

  const openLeavePrompt = useCallback((onConfirmLeave) => {
    if (askingRef.current) return;
    askingRef.current = true;
    resolverRef.current = (shouldLeave) => {
      if (shouldLeave) onConfirmLeave?.();
    };
    setPending(true);
  }, []);

  const requestLeave = useCallback(() => {
    if (!isDirtyRef.current) return Promise.resolve(true);
    if (askingRef.current) return Promise.resolve(false);
    askingRef.current = true;
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setPending(true);
    });
  }, []);

  useEffect(() => {
    if (!isDirty) return undefined;

    function onBeforeUnload(event) {
      event.preventDefault();
      event.returnValue = "";
    }

    function onDocumentClick(event) {
      if (bypassRef.current) return;
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
      openLeavePrompt(() => {
        bypassRef.current = true;
        router.push(destination);
        queueMicrotask(() => {
          bypassRef.current = false;
        });
      });
    }

    function rearmHistoryTrap() {
      window.history.pushState(
        { __unsavedGuard: true },
        "",
        window.location.href
      );
    }

    function onPopState() {
      if (bypassRef.current) return;
      if (!isDirtyRef.current) return;

      // Stay on the dirty URL (Next may have already moved).
      const dirtyUrl = dirtyUrlRef.current;
      if (
        dirtyUrl &&
        dirtyUrl !==
          window.location.pathname +
            window.location.search +
            window.location.hash
      ) {
        router.replace(dirtyUrl);
      }
      rearmHistoryTrap();

      openLeavePrompt(() => {
        bypassRef.current = true;
        // Drop the trap entry, then leave to the real previous page.
        window.history.go(-2);
        window.setTimeout(() => {
          bypassRef.current = false;
        }, 0);
      });
    }

    // Trap so the first Back/Forward hits popstate while we can still prompt.
    rearmHistoryTrap();

    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onDocumentClick, true);
    window.addEventListener("popstate", onPopState);

    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onDocumentClick, true);
      window.removeEventListener("popstate", onPopState);

      // Collapse the trap entry if we're still sitting on it.
      if (
        !bypassRef.current &&
        window.history.state?.__unsavedGuard &&
        !isDirtyRef.current
      ) {
        bypassRef.current = true;
        window.history.back();
        window.setTimeout(() => {
          bypassRef.current = false;
        }, 0);
      }
    };
  }, [isDirty, openLeavePrompt, router]);

  const dialog = (
    <UnsavedChangesDialog
      open={pending}
      onStay={() => closePending(false)}
      onLeave={() => closePending(true)}
    />
  );

  return { requestLeave, dialog };
}
