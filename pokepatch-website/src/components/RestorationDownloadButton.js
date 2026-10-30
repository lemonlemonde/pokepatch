"use client";

import { useState } from "react";
import {
  downloadRestorationZip,
  restorationFolderName,
} from "@/lib/downloadRestorationZip";

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

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="h-4 w-4 animate-spin rounded-full border-2 border-night/40 border-t-night"
    />
  );
}

/**
 * Icon-only download → `<order>-<card>.zip` with `before/` + `after/`.
 * Shared by My Orders and the admin order editor.
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
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const total = before.length + after.length;

  async function handleClick() {
    if (busy || total === 0) return;
    setBusy(true);
    setMessage(null);
    try {
      const failures = await downloadRestorationZip({
        folderName: restorationFolderName({
          orderDisplayId,
          cardIndex,
          cardName,
        }),
        before,
        after,
      });
      if (failures.length > 0) {
        setMessage({
          tone: "warn",
          text: `${failures.length} photo${failures.length === 1 ? "" : "s"} couldn't be included. Try again later.`,
        });
      }
    } catch (err) {
      setMessage({
        tone: "error",
        text: err instanceof Error ? err.message : "Download failed.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || busy || total === 0}
        aria-label={busy ? "Preparing download" : "Download before & after photos"}
        title="Download before & after photos"
        aria-busy={busy}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-ink text-night transition hover:bg-ink/90 disabled:cursor-not-allowed disabled:bg-ink/30"
      >
        {busy ? <Spinner /> : <DownloadIcon />}
      </button>
      {message ? (
        <p
          className={`mt-1.5 text-[11px] ${
            message.tone === "error" ? "text-peach" : "text-ink/55"
          }`}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
