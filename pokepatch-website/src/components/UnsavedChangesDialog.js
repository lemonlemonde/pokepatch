"use client";

import { useEffect } from "react";

const DEFAULT_TITLE = "Unsaved changes";
const DEFAULT_BODY =
  "You have unsaved changes. If you leave now, those edits will be lost.";

export default function UnsavedChangesDialog({
  open,
  title = DEFAULT_TITLE,
  body = DEFAULT_BODY,
  stayLabel = "Keep editing",
  leaveLabel = "Leave without saving",
  onStay,
  onLeave,
}) {
  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(event) {
      if (event.key === "Escape") onStay();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onStay]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-night/70 px-4 py-6"
      role="presentation"
      onClick={onStay}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="unsaved-changes-title"
        aria-describedby="unsaved-changes-body"
        className="w-full max-w-md overflow-hidden rounded-2xl border-2 border-ink/15 bg-cream shadow-cozy"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-ink/10 px-5 py-4">
          <h2
            id="unsaved-changes-title"
            className="text-xl font-bold text-ink"
          >
            {title}
          </h2>
          <p id="unsaved-changes-body" className="mt-1.5 text-sm text-ink/70">
            {body}
          </p>
        </div>
        <div className="flex flex-col-reverse gap-2 px-5 py-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onStay}
            className="rounded-xl border-2 border-ink/20 px-4 py-2 text-sm font-semibold text-ink transition hover:border-blush"
          >
            {stayLabel}
          </button>
          <button
            type="button"
            onClick={onLeave}
            className="rounded-xl bg-berry px-4 py-2 text-sm font-semibold text-night shadow-cozy transition hover:brightness-110"
          >
            {leaveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
