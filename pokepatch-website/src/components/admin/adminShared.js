"use client";

import { useEffect, useState } from "react";
import { forgetSignedUrl } from "@/lib/signedUrlCache";
import { thumbPath } from "@/lib/imageCompression";

export function formatDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function deliveryLabel(value) {
  if (value === "local_dropoff") return "Local drop-off";
  if (value === "shipping") return "Shipping";
  return value ?? "";
}

export function deliveryShortLabel(value) {
  if (value === "local_dropoff") return "Local";
  if (value === "shipping") return "Ship";
  return deliveryLabel(value);
}

export function LoadingIndicator({ label = "Loading…", compact = false, className = "" }) {
  const spinner = (
    <div
      aria-hidden="true"
      className={`animate-spin rounded-full border-ink/15 border-t-ink border-r-ink ${
        compact ? "h-4 w-4 border-2" : "h-10 w-10 border-4"
      }`}
    />
  );

  if (compact) {
    return (
      <span
        role="status"
        aria-live="polite"
        className={`inline-flex items-center gap-2 text-sm font-semibold text-ink/60 ${className}`}
      >
        {spinner}
        {label}
      </span>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex flex-col items-center justify-center gap-3 py-12 ${className}`}
    >
      {spinner}
      <p className="animate-soft-bounce text-sm font-semibold text-ink/70">{label}</p>
    </div>
  );
}

export function AccountStatusBadge({ hasAccount, pill = false }) {
  const shape = pill
    ? "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold"
    : "inline-block rounded px-1.5 py-0.5 text-xs font-semibold";
  if (hasAccount) {
    return <span className={`${shape} bg-mint text-night`}>Has account</span>;
  }
  return (
    <span className={`${shape} bg-ink/10 text-ink/55`}>No account</span>
  );
}

export function KanbanThumbImg({ url, storagePath, className }) {
  const [src, setSrc] = useState(url);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setSrc(url);
    setFailed(false);
  }, [url]);

  if (!src || failed) {
    return <div className={`bg-night/50 ${className ?? ""}`} />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      className={className}
      draggable={false}
      onError={() => {
        if (storagePath) {
          forgetSignedUrl("card-photos", thumbPath(storagePath));
        }
        setFailed(true);
      }}
    />
  );
}

export function formatDateShort(value) {
  if (!value) return "";
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

