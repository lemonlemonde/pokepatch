"use client";

import { useState, useSyncExternalStore } from "react";
import {
  downloadRestorationZip,
  restorationFolderName,
  saveRestorationToFolder,
  supportsFolderSave,
} from "@/lib/restorationDownload";

function DownloadIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M4 19h16" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </svg>
  );
}

const noopSubscribe = () => () => {};

/** Capability is browser-only; render the zip label on the server to avoid hydration drift. */
function useFolderSaveSupport() {
  return useSyncExternalStore(noopSubscribe, supportsFolderSave, () => false);
}

function failureNote(failures) {
  if (failures.length === 0) return null;
  return `${failures.length} photo${failures.length === 1 ? "" : "s"} couldn't be included. Try again later.`;
}

/**
 * Save a card's before/after photos as `<order>-<card>/before|after/...`.
 * Writes directly into a chosen folder where the browser allows it; otherwise
 * downloads a zip with the same layout. Shared by My Orders and the admin editor.
 */
export default function RestorationDownloadButton({
  orderDisplayId,
  cardIndex,
  cardName,
  before,
  after,
  disabled = false,
  className = "",
}) {
  const canSaveToFolder = useFolderSaveSupport();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const total = before.length + after.length;

  async function handleClick() {
    if (busy || total === 0) return;
    setBusy(true);
    setMessage(null);
    const params = {
      folderName: restorationFolderName({ orderDisplayId, cardIndex, cardName }),
      before,
      after,
    };
    try {
      if (canSaveToFolder) {
        const result = await saveRestorationToFolder(params);
        if (result.cancelled) return;
        if (!result.unavailable) {
          setMessage({
            tone: result.failures.length > 0 ? "warn" : "ok",
            text:
              failureNote(result.failures) ?? `Saved to ${result.location}/`,
          });
          return;
        }
      }
      const { failures } = await downloadRestorationZip(params);
      const note = failureNote(failures);
      if (note) setMessage({ tone: "warn", text: note });
    } catch (err) {
      setMessage({
        tone: "error",
        text: err instanceof Error ? err.message : "Download failed.",
      });
    } finally {
      setBusy(false);
    }
  }

  const idleLabel = canSaveToFolder
    ? "Save before & after"
    : "Download before & after";
  const busyLabel = canSaveToFolder ? "Saving…" : "Preparing zip…";

  return (
    <div className={className}>
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || busy || total === 0}
        className="inline-flex items-center gap-2 rounded-lg bg-ink px-3 py-1.5 text-sm font-semibold text-night transition hover:bg-ink/90 disabled:cursor-not-allowed disabled:bg-ink/30"
      >
        {canSaveToFolder ? <FolderIcon /> : <DownloadIcon />}
        {busy ? busyLabel : idleLabel}
      </button>
      {message ? (
        <p
          className={`mt-1.5 text-[11px] ${
            message.tone === "error"
              ? "text-peach"
              : message.tone === "ok"
                ? "text-mint"
                : "text-ink/55"
          }`}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
