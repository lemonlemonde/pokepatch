"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import CustomerPriorityBadge from "@/components/CustomerPriorityBadge";
import { signPaths } from "@/lib/customerOrderMedia";
import {
  hasPriorityAdjustment,
  unpackQuoteAdjustments,
} from "@/lib/servicePricing";
import {
  customerOrderStatusLabel,
  isPendingOrderStatus,
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
  const statusChipLabel =
    order.queue_position != null
      ? isPriority
        ? `Priority · #${order.queue_position} in queue`
        : `#${order.queue_position} in queue`
      : customerOrderStatusLabel(
          order.status,
          order.pending_kind,
          order.delivery_method,
        );
  const hasUnreadMessages = Boolean(order.has_unread_messages);
  const lastUpdatedAt = hasUnreadMessages
    ? order.latest_unread_message_at ?? order.latest_message_at
    : order.latest_message_at ?? latestActivityAt(order);
  const activityChipLabel = hasUnreadMessages
    ? "New message"
    : formatUpdateTime(lastUpdatedAt) || "View order";
  const editable = isPendingOrderStatus(order.status);

  return (
    <Link
      href={`/my-orders/detail/?id=${encodeURIComponent(order.id)}`}
      className="marketing-panel flex items-center gap-3 p-3 transition hover:border-ink/25 sm:p-4"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium tracking-tight text-ink">
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
          {isPriority ? <CustomerPriorityBadge /> : null}
          {editable ? (
            <span className="inline-flex rounded-full border border-mint/35 bg-mint/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-mint">
              Editable
            </span>
          ) : null}
          {hasUnreadMessages ? (
            <span className="inline-flex rounded-full bg-mint px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-night">
              New
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-xs text-ink/55">
          {formatDate(order.created_at)} · {cardCountText}
          {activityChipLabel ? ` · ${activityChipLabel}` : ""}
        </p>
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
