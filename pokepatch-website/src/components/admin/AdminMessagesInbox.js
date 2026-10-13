"use client";

import { useCallback, useEffect, useState } from "react";
import {
  adminListUnreadMessages,
  adminMarkMessagesRead,
} from "@/lib/adminApi";
import {
  LoadingIndicator,
  formatDate,
} from "@/components/admin/adminShared";
import {
  normalizeOrderStatus,
  orderDisplayLabel,
  orderStatusBadgeClass,
} from "@/lib/orderStatus";

function truncateText(value, max = 160) {
  const text = String(value ?? "")
    .replace(/^Regarding Order #\d+\s*/i, "")
    .trim();
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export default function AdminMessagesInbox({ onOpenOrder }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openingId, setOpeningId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await adminListUnreadMessages({ limit: 200 });
      setOrders(result.orders ?? []);
    } catch (err) {
      setError(err.message || "Failed to load messages");
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleOpen(orderId) {
    if (!orderId || openingId) return;
    setOpeningId(orderId);
    setError("");
    try {
      await adminMarkMessagesRead(orderId);
      setOrders((current) => current.filter((row) => row.id !== orderId));
      onOpenOrder?.(orderId);
    } catch (err) {
      setError(err.message || "Could not open message");
    } finally {
      setOpeningId(null);
    }
  }

  if (loading && orders.length === 0) {
    return <LoadingIndicator label="Loading messages…" />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink/60">
          {orders.length === 0
            ? "No new messages."
            : `${orders.length} ${
                orders.length === 1 ? "order has" : "orders have"
              } new messages.`}
        </p>
        <button
          type="button"
          onClick={load}
          disabled={loading || Boolean(openingId)}
          className="rounded-lg border border-ink/15 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-ink/60 transition hover:border-ink/30 hover:text-ink disabled:opacity-40"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error ? (
        <p className="rounded-lg border border-error/40 bg-error/10 px-3 py-2 text-sm text-error">
          {error}
        </p>
      ) : null}

      {orders.length === 0 && !error ? (
        <div className="rounded-2xl border border-dashed border-ink/15 px-4 py-12 text-center">
          <p className="text-sm text-ink/45">
            Inbox is clear. Customer messages show up here until you open them.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {orders.map((order) => {
            const unreadCount = Math.max(1, Number(order.unread_count) || 1);
            const preview =
              truncateText(order.latest_body) ||
              truncateText(order.latest_subject) ||
              "New message";
            const busy = openingId === order.id;
            return (
              <li key={order.id}>
                <button
                  type="button"
                  onClick={() => handleOpen(order.id)}
                  disabled={Boolean(openingId)}
                  className="flex w-full flex-col gap-2 rounded-xl border border-sky/30 bg-sky/10 px-4 py-3 text-left transition hover:border-sky/50 hover:bg-sky/15 disabled:opacity-50 sm:flex-row sm:items-start sm:justify-between"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-ink">
                        Order #{order.display_id}
                      </span>
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${orderStatusBadgeClass(
                          order.status,
                          order.pending_kind
                        )}`}
                      >
                        {orderDisplayLabel(
                          normalizeOrderStatus(order.status),
                          order.pending_kind
                        )}
                      </span>
                      <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-peach px-1.5 text-[10px] font-bold leading-5 text-night">
                        {unreadCount > 99 ? "99+" : unreadCount}
                      </span>
                    </span>
                    <span className="mt-1 block text-sm text-ink/75">
                      {order.customer_name || order.customer_email || "Customer"}
                    </span>
                    <span className="mt-1 block text-sm leading-relaxed text-ink/85">
                      {preview}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-ink/45 sm:pt-0.5 sm:text-right">
                    {busy ? "Opening…" : formatDate(order.latest_sent_at)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
