"use client";

import { useCallback, useEffect, useState } from "react";
import {
  adminListQueueOrders,
  adminReorderQueueOrders,
} from "@/lib/adminApi";
import {
  orderStatusBadgeClass,
  orderStatusLabel,
  normalizeOrderStatus,
} from "@/lib/orderStatus";

function LoadingIndicator({ label = "Loading…" }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center justify-center gap-3 py-12"
    >
      <div
        aria-hidden="true"
        className="h-10 w-10 animate-spin rounded-full border-4 border-ink/15 border-t-berry border-r-blush"
      />
      <p className="animate-soft-bounce text-sm font-semibold text-ink/70">
        {label}
      </p>
    </div>
  );
}

function formatCreatedAt(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function QueuePriorityBoard() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [dragId, setDragId] = useState(null);
  const [dropIndex, setDropIndex] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const rows = await adminListQueueOrders();
      setOrders(rows);
    } catch (err) {
      setError(err?.message || "Could not load queue.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const persistOrder = useCallback(async (nextOrders) => {
    setSaving(true);
    setError("");
    try {
      const rows = await adminReorderQueueOrders(nextOrders.map((o) => o.id));
      setOrders(rows);
    } catch (err) {
      setError(err?.message || "Could not save queue order.");
      await refresh();
    } finally {
      setSaving(false);
    }
  }, [refresh]);

  const moveDragToIndex = useCallback(
    (targetIndex) => {
      if (!dragId || targetIndex == null) return;
      const fromIndex = orders.findIndex((o) => o.id === dragId);
      if (fromIndex < 0) return;

      let insertAt = targetIndex;
      if (fromIndex < insertAt) insertAt -= 1;
      if (insertAt === fromIndex) return;

      const next = [...orders];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(insertAt, 0, moved);
      setOrders(next);
      setDragId(null);
      setDropIndex(null);
      void persistOrder(next);
    },
    [dragId, orders, persistOrder]
  );

  if (loading && orders.length === 0) {
    return <LoadingIndicator label="Loading queue…" />;
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-lg border border-berry/40 bg-berry/10 px-3 py-2 text-sm text-berry">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-ink/70">
        <p>
          Drag orders to set priority. Higher in the list = earlier in the card
          queue. Cards inside an order stay sequential.
        </p>
        {(saving || loading) && (
          <span className="text-xs font-semibold text-ink/50">
            {saving ? "Saving…" : "Refreshing…"}
          </span>
        )}
      </div>

      {orders.length === 0 ? (
        <p className="rounded-2xl border-2 border-dashed border-ink/15 px-4 py-10 text-center text-sm text-ink/60">
          No to-do or in-progress orders in the queue.
        </p>
      ) : (
        <ul className="space-y-2">
          {orders.map((order, index) => {
            const status = normalizeOrderStatus(order.status);
            const activeCount = Number(order.active_card_count ?? 0);
            const totalCount = Number(order.card_count ?? 0);
            const isDragging = dragId === order.id;
            const showDropBefore = dropIndex === index && dragId && dragId !== order.id;

            return (
              <li key={order.id}>
                {showDropBefore && (
                  <div
                    className="mb-2 h-1 rounded-full bg-berry"
                    aria-hidden="true"
                  />
                )}
                <div
                  draggable={!saving}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", order.id);
                    setDragId(order.id);
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setDropIndex(null);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    const rect = event.currentTarget.getBoundingClientRect();
                    const midY = rect.top + rect.height / 2;
                    setDropIndex(
                      event.clientY < midY ? index : index + 1
                    );
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const rect = event.currentTarget.getBoundingClientRect();
                    const midY = rect.top + rect.height / 2;
                    moveDragToIndex(event.clientY < midY ? index : index + 1);
                  }}
                  className={`flex cursor-grab items-center gap-3 rounded-2xl border-2 border-ink/10 bg-cream px-4 py-3 shadow-sm active:cursor-grabbing ${
                    isDragging ? "opacity-40" : ""
                  }`}
                >
                  <span
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-night/10 text-xs font-bold text-ink/70"
                    title="Queue place"
                  >
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-bold text-ink">
                        #{order.display_id}{" "}
                        <span className="font-semibold text-ink/80">
                          {order.customer_name || "Unknown"}
                        </span>
                      </p>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${orderStatusBadgeClass(
                          status
                        )}`}
                      >
                        {orderStatusLabel(status)}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-ink/55">
                      {formatCreatedAt(order.created_at)}
                      {order.customer_email
                        ? ` · ${order.customer_email}`
                        : ""}
                      {` · ${activeCount} ${
                        activeCount === 1 ? "card" : "cards"
                      } in queue`}
                      {totalCount > activeCount
                        ? ` (${totalCount} total)`
                        : ""}
                    </p>
                  </div>
                  <span
                    className="shrink-0 text-ink/35"
                    aria-hidden="true"
                    title="Drag to reorder"
                  >
                    ⋮⋮
                  </span>
                </div>
              </li>
            );
          })}
          {dropIndex === orders.length && dragId && (
            <div className="h-1 rounded-full bg-berry" aria-hidden="true" />
          )}
        </ul>
      )}
    </div>
  );
}
