"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { signPaths } from "@/lib/customerOrderMedia";
import {
  hasPriorityAdjustment,
  unpackQuoteAdjustments,
} from "@/lib/servicePricing";
import {
  customerOrderStatusChipLabel,
  orderStatusBadgeClass,
} from "@/lib/orderStatus";

function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatUpdateTime(dateString) {
  if (!dateString) return null;
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function latestTimestamp(...values) {
  let bestMs = null;
  for (const value of values) {
    if (!value) continue;
    const ms = new Date(value).getTime();
    if (Number.isNaN(ms)) continue;
    if (bestMs === null || ms > bestMs) bestMs = ms;
  }
  return bestMs === null ? null : new Date(bestMs).toISOString();
}

function latestActivityAt(order) {
  return latestTimestamp(
    order?.updates_available_at,
    order?.status_changed_at,
    order?.created_at
  );
}

/**
 * Compact My Orders list row — detail/edit lives on /my-orders/[orderId].
 * Status is the only word chip; priority is a bolt icon; unread is a count badge.
 */
function PriorityBoltIcon({ className = "" }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M9 1 4 9h3.5L6.5 15 12 7H8.5L9 1Z" />
    </svg>
  );
}

export default function OrderCard({ order }) {
  const [previewUrl, setPreviewUrl] = useState(null);
  const previewPaths = Array.isArray(order.preview_paths)
    ? order.preview_paths
    : [];
  const previewPath = previewPaths[0] ?? null;

  useEffect(() => {
    if (!previewPath) return undefined;
    let active = true;
    signPaths([previewPath], { preferThumb: true }).then((map) => {
      if (active) setPreviewUrl(map[previewPath] ?? null);
    });
    return () => {
      active = false;
    };
  }, [previewPath]);

  const displayPreviewUrl = previewPath ? previewUrl : null;

  const cardCountText =
    order.card_count === 1 ? "1 card" : `${order.card_count} cards`;
  const listQuoteAdjustments = unpackQuoteAdjustments(order.quote_bulk_counts, {
    overrideLabel: order.quote_override_label ?? "",
    overrideAmount: order.quote_override_amount,
  });
  const isPriority =
    Boolean(order.is_priority) || hasPriorityAdjustment(listQuoteAdjustments);
  // Bolt icon carries priority; keep queue chip text without a Priority prefix.
  const statusChipLabel = customerOrderStatusChipLabel(order, {
    isPriority: false,
  });
  const unreadCount = Math.max(
    0,
    Number(order.unread_message_count) ||
      (order.has_unread_messages ? 1 : 0)
  );
  const hasUnreadMessages = unreadCount > 0;
  const lastUpdatedAt = hasUnreadMessages
    ? order.latest_unread_message_at ?? order.latest_message_at
    : order.latest_message_at ?? latestActivityAt(order);
  const activityChipLabel = formatUpdateTime(lastUpdatedAt) || "View order";
  const unreadBadgeLabel = unreadCount > 99 ? "99+" : String(unreadCount);
  const metaParts = [
    formatDate(order.created_at),
    cardCountText,
    activityChipLabel,
  ].filter(Boolean);

  return (
    <Link
      href={`/my-orders/detail/?id=${encodeURIComponent(order.id)}`}
      className="marketing-panel relative flex items-center gap-3 p-3 transition hover:border-ink/25 sm:p-4"
    >
      {hasUnreadMessages ? (
        <span
          className="absolute -right-1.5 -top-1.5 z-10 inline-flex min-w-5 items-center justify-center rounded-full bg-peach px-1 text-[10px] font-bold leading-5 text-night shadow-sm"
          aria-label={
            unreadCount === 1
              ? "1 unread message"
              : `${unreadBadgeLabel} unread messages`
          }
        >
          {unreadBadgeLabel}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p
            className={`flex items-center gap-1.5 tracking-tight text-ink ${
              hasUnreadMessages ? "font-semibold" : "font-medium"
            }`}
          >
            {isPriority ? (
              <span
                className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-status-yellow text-night"
                title="Priority service"
                aria-label="Priority service"
              >
                <PriorityBoltIcon className="h-3 w-3" />
              </span>
            ) : null}
            Order #{order.display_id}
          </p>
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${orderStatusBadgeClass(
              order.status,
              order.pending_kind
            )}`}
          >
            {statusChipLabel}
          </span>
        </div>
        <p className="mt-1 text-xs text-ink/55">{metaParts.join(" · ")}</p>
      </div>

      <div className="h-14 w-11 shrink-0 overflow-hidden rounded-lg border border-ink/10 bg-night/40">
        {displayPreviewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={displayPreviewUrl}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="h-full w-full animate-pulse bg-ink/5" />
        )}
      </div>

      <span className="shrink-0 text-sm font-semibold text-ink/50">View →</span>
    </Link>
  );
}
