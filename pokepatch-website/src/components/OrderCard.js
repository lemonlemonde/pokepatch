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
import CustomerPriorityBadge from "@/components/CustomerPriorityBadge";

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
 * Status is the only word chip; priority is a compact P badge; unread is a count badge.
 */
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
  // Compact P badge carries priority; keep queue chip text without a Priority prefix.
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
  const detailHref = `/my-orders/detail/?id=${encodeURIComponent(order.id)}`;
  const queueHref =
    order.queue_position != null && order.display_id != null
      ? `/queue/?order=${encodeURIComponent(order.display_id)}`
      : null;

  return (
    <div className="marketing-panel relative flex items-center gap-3 p-3 transition hover:border-ink/25 sm:p-4">
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
          {isPriority ? <CustomerPriorityBadge /> : null}
          <Link
            href={detailHref}
            className={`tracking-tight text-ink hover:underline ${
              hasUnreadMessages ? "font-semibold" : "font-medium"
            }`}
          >
            Order #{order.display_id}
          </Link>
          <Link
            href={detailHref}
            className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${orderStatusBadgeClass(
              order.status,
              order.pending_kind
            )}`}
          >
            {statusChipLabel}
          </Link>
          {queueHref ? (
            <Link
              href={queueHref}
              className="inline-flex rounded-full border border-ink/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink/55 transition hover:border-ink/35 hover:text-ink"
            >
              View queue
            </Link>
          ) : null}
        </div>
        <Link href={detailHref} className="mt-1 block text-xs text-ink/55">
          {metaParts.join(" · ")}
        </Link>
      </div>

      <Link
        href={detailHref}
        className="h-14 w-11 shrink-0 overflow-hidden rounded-lg border border-ink/10 bg-night/40"
        tabIndex={-1}
        aria-hidden="true"
      >
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
      </Link>

      <Link
        href={detailHref}
        className="shrink-0 text-sm font-semibold text-ink/50"
      >
        View →
      </Link>
    </div>
  );
}
