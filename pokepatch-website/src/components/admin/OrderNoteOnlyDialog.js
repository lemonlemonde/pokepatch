"use client";

import { useEffect, useState } from "react";

function fieldClassName() {
  return "w-full rounded-xl border border-ink/15 bg-cream px-3.5 py-2.5 text-sm text-ink outline-none transition focus:border-mint focus:ring-2 focus:ring-mint/20";
}

/** Note-only message — no order edit / no diff. */
export default function OrderNoteOnlyDialog({
  open,
  displayId,
  customerEmail,
  sending = false,
  onCancel,
  onSend,
}) {
  const defaultSubject =
    displayId != null
      ? `Update on your order #${displayId}`
      : "Update on your order";
  const [subject, setSubject] = useState(defaultSubject);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setSubject(defaultSubject);
    setNote("");
    setError("");
  }, [open, defaultSubject]);

  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(event) {
      if (event.key === "Escape" && !sending) onCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, sending, onCancel]);

  if (!open) return null;

  function handleSend() {
    setError("");
    if (!customerEmail?.trim()) {
      setError("No email on this order.");
      return;
    }
    if (!subject.trim()) {
      setError("Add a subject.");
      return;
    }
    if (!note.trim()) {
      setError("Write a message.");
      return;
    }
    onSend({ subject: subject.trim(), body: note.trim() });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-night/70 px-4 py-6"
      role="presentation"
      onClick={() => {
        if (!sending) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border-2 border-ink/15 bg-cream shadow-cozy"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-ink/10 px-5 py-4">
          <h2 className="text-xl font-bold text-ink">Send message</h2>
          <p className="mt-1 text-xs text-ink/50">
            Emails {customerEmail || "—"} and appears in Messages.
          </p>
        </div>
        <div className="space-y-4 px-5 py-4">
          {error ? (
            <p className="rounded-xl border border-berry/30 bg-berry/10 px-3 py-2 text-sm text-berry">
              {error}
            </p>
          ) : null}
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-ink">
              Subject
            </span>
            <input
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              disabled={sending}
              className={fieldClassName()}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-ink">
              Note
            </span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={5}
              disabled={sending}
              placeholder="Write a message…"
              className={fieldClassName()}
            />
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-ink/10 px-5 py-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={sending}
            className="rounded-xl border-2 border-ink/20 px-4 py-2 text-sm font-semibold text-ink transition hover:border-blush disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={sending}
            className="rounded-xl bg-berry px-4 py-2 text-sm font-semibold text-night shadow-cozy transition hover:brightness-110 disabled:opacity-40"
          >
            {sending ? "Sending…" : "Send message"}
          </button>
        </div>
      </div>
    </div>
  );
}
